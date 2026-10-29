//! CMake configure/build processes: one per project and window, their whole process tree
//! cancellable (a Windows job object, a Unix process group), output streamed in batches.
use serde::Serialize;
use std::{
    collections::HashMap,
    io::Read,
    path::Path,
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex, MutexGuard, PoisonError,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::Duration,
};

// Output is sent at most this often, so a fast build does not flood the renderer.
const BATCH: Duration = Duration::from_millis(50);
#[cfg(unix)]
const KILL_GRACE: Duration = Duration::from_millis(1500);

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum JobEvent {
    Output { text: String },
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A child and everything it starts.
struct Tree {
    child: Mutex<Child>,
    #[cfg_attr(windows, allow(dead_code))]
    pid: u32,
    #[cfg(windows)]
    job: isize,
}
// The job handle is only used through thread-safe Win32 calls.
unsafe impl Send for Tree {}
unsafe impl Sync for Tree {}

impl Tree {
    fn spawn(mut command: Command) -> std::io::Result<Self> {
        super::kits::hide_window(&mut command);
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let child = command.spawn()?;
        #[cfg(windows)]
        let job = unsafe {
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::System::JobObjects::*;
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if !job.is_null() {
                let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    &limits as *const _ as *const _,
                    std::mem::size_of_val(&limits) as u32,
                );
                AssignProcessToJobObject(job, child.as_raw_handle() as _);
            }
            job as isize
        };
        Ok(Self {
            pid: child.id(),
            child: Mutex::new(child),
            #[cfg(windows)]
            job,
        })
    }
    fn kill(&self) {
        #[cfg(windows)]
        unsafe {
            if self.job != 0 {
                windows_sys::Win32::System::JobObjects::TerminateJobObject(self.job as _, 1);
            }
        }
        #[cfg(unix)]
        {
            let pid = self.pid as i32;
            unsafe { libc::kill(-pid, libc::SIGTERM) };
            thread::sleep(KILL_GRACE);
            unsafe { libc::kill(-pid, libc::SIGKILL) };
        }
        if let Ok(mut child) = self.child.try_lock() {
            let _ = child.kill();
        }
    }
}
impl Drop for Tree {
    fn drop(&mut self) {
        #[cfg(windows)]
        unsafe {
            if self.job != 0 {
                windows_sys::Win32::Foundation::CloseHandle(self.job as _);
            }
        }
    }
}

struct Running {
    window: String,
    tree: Arc<Tree>,
    cancelled: Arc<AtomicBool>,
}

#[derive(Clone, Default)]
pub struct Jobs {
    running: Arc<Mutex<HashMap<String, Running>>>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Finished {
    pub code: Option<i32>,
    pub cancelled: bool,
}

/// How a command line is shown in the output: arguments with spaces are quoted.
pub fn shown(program: &Path, args: &[String]) -> String {
    std::iter::once(program.display().to_string())
        .chain(args.iter().cloned())
        .map(|a| {
            if a.contains(' ') {
                format!("\"{a}\"")
            } else {
                a
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

impl Jobs {
    pub fn busy(&self, key: &str) -> bool {
        lock(&self.running).contains_key(key)
    }
    /// Runs one step and waits for it; output goes to `sink` in batches.
    #[allow(clippy::too_many_arguments)]
    pub fn run(
        &self,
        window: &str,
        key: &str,
        program: &Path,
        args: &[String],
        cwd: &Path,
        env: &[(String, String)],
        sink: Arc<dyn Fn(JobEvent) + Send + Sync>,
    ) -> Result<Finished, String> {
        let mut command = Command::new(program);
        command
            .args(args)
            .current_dir(cwd)
            .envs(env.iter().map(|(k, v)| (k, v)))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let cancelled = Arc::new(AtomicBool::new(false));
        let tree = {
            let mut running = lock(&self.running);
            if running.contains_key(key) {
                return Err("A CMake task is already running for this project".into());
            }
            let tree = Arc::new(
                Tree::spawn(command)
                    .map_err(|e| format!("Could not start {}: {e}", program.display()))?,
            );
            running.insert(
                key.to_owned(),
                Running {
                    window: window.to_owned(),
                    tree: tree.clone(),
                    cancelled: cancelled.clone(),
                },
            );
            tree
        };
        let result = self.stream(&tree, sink);
        lock(&self.running).remove(key);
        let code = result?;
        Ok(Finished {
            code,
            cancelled: cancelled.load(Ordering::SeqCst),
        })
    }
    fn stream(
        &self,
        tree: &Tree,
        sink: Arc<dyn Fn(JobEvent) + Send + Sync>,
    ) -> Result<Option<i32>, String> {
        let (stdout, stderr) = {
            let mut child = lock(&tree.child);
            (child.stdout.take(), child.stderr.take())
        };
        let (sender, receiver) = mpsc::channel::<Vec<u8>>();
        let readers: Vec<_> = [
            stdout.map(|s| Box::new(s) as Box<dyn Read + Send>),
            stderr.map(|s| Box::new(s) as Box<dyn Read + Send>),
        ]
        .into_iter()
        .flatten()
        .map(|mut pipe| {
            let sender = sender.clone();
            thread::spawn(move || {
                let mut buffer = vec![0; 16 * 1024];
                while let Ok(read) = pipe.read(&mut buffer) {
                    if read == 0 || sender.send(buffer[..read].to_vec()).is_err() {
                        break;
                    }
                }
            })
        })
        .collect();
        drop(sender);
        let mut pending = Vec::new();
        let flush = |pending: &mut Vec<u8>, all: bool| {
            // Send whole lines; a partial line waits for its end (or the process end).
            let cut = if all {
                pending.len()
            } else {
                pending
                    .iter()
                    .rposition(|&b| b == b'\n')
                    .map_or(0, |i| i + 1)
            };
            if cut > 0 {
                let text = String::from_utf8_lossy(&pending[..cut]).into_owned();
                pending.drain(..cut);
                sink(JobEvent::Output { text });
            }
        };
        loop {
            match receiver.recv_timeout(BATCH) {
                Ok(bytes) => {
                    pending.extend(bytes);
                    while let Ok(more) = receiver.try_recv() {
                        pending.extend(more);
                    }
                    flush(&mut pending, false);
                    thread::sleep(BATCH);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => flush(&mut pending, false),
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        flush(&mut pending, true);
        for reader in readers {
            let _ = reader.join();
        }
        let status = lock(&tree.child).wait().map_err(|e| e.to_string())?;
        Ok(status.code())
    }
    pub fn cancel(&self, window: &str, key: &str) {
        let running = lock(&self.running);
        if let Some(job) = running.get(key).filter(|j| j.window == window) {
            job.cancelled.store(true, Ordering::SeqCst);
            let tree = job.tree.clone();
            thread::spawn(move || tree.kill());
        }
    }
    pub fn close_window(&self, window: &str) {
        for job in lock(&self.running).values().filter(|j| j.window == window) {
            job.cancelled.store(true, Ordering::SeqCst);
            job.tree.kill();
        }
    }
    pub fn close_all(&self) {
        for job in lock(&self.running).values() {
            job.cancelled.store(true, Ordering::SeqCst);
            job.tree.kill();
        }
    }
}
