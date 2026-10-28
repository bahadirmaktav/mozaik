import { useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import './App.css';

export default function App() {
  const [error, setError] = useState('');
  return <main className="shell">
    <header className="toolbar"><strong>Tessera</strong><span>Workspace</span>
      <button onClick={() => isTauri() ? void invoke('new_workspace').catch(e => setError(String(e))) : setError('Open the desktop app to create another window.')}>New window</button>
    </header>
    <section className="empty"><h1>A little space to think.</h1><p>Your workspace starts here.</p></section>
    {error && <p role="alert">{error}</p>}
  </main>;
}
