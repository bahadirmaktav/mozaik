/**
 * CMake for the Code Editor without a language server: highlighting (commands, control flow,
 * `${…}` variables, `$<…>` generator expressions, known keywords, bracket comments and
 * arguments) and completion from CMake's own commands, keywords and variables plus the
 * targets, variables and functions the file defines. Offline and in the renderer; Mozaik
 * starts no CMake language server (only clangd, see AGENTS.md).
 */
import {
  StreamLanguage,
  type StreamParser,
  type StringStream,
} from "@codemirror/language";
import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import { tags } from "@lezer/highlight";

const CONTROL = new Set(
  "if elseif else endif foreach endforeach while endwhile function endfunction macro endmacro block endblock return break continue".split(
    " ",
  ),
);
export const COMMANDS = [
  ...CONTROL,
  ..."cmake_minimum_required project add_executable add_library add_subdirectory add_custom_command add_custom_target add_dependencies add_compile_definitions add_compile_options add_definitions add_link_options add_test aux_source_directory cmake_host_system_information cmake_language cmake_parse_arguments cmake_path cmake_policy configure_file define_property enable_language enable_testing execute_process export file find_file find_library find_package find_path find_program get_cmake_property get_directory_property get_filename_component get_property get_source_file_property get_target_property get_test_property include include_directories include_guard install link_directories link_libraries list mark_as_advanced math message option remove_definitions separate_arguments set set_directory_properties set_property set_source_files_properties set_target_properties set_tests_properties site_name source_group string target_compile_definitions target_compile_features target_compile_options target_include_directories target_link_directories target_link_libraries target_link_options target_precompile_headers target_sources try_compile try_run unset variable_watch FetchContent_Declare FetchContent_MakeAvailable FetchContent_GetProperties ExternalProject_Add gtest_discover_tests check_include_file check_cxx_compiler_flag check_cxx_source_compiles write_basic_package_version_file configure_package_config_file".split(
    " ",
  ),
];
export const KEYWORDS =
  "PUBLIC PRIVATE INTERFACE STATIC SHARED MODULE OBJECT IMPORTED ALIAS GLOBAL EXCLUDE_FROM_ALL WIN32 MACOSX_BUNDLE VERSION LANGUAGES DESCRIPTION HOMEPAGE_URL REQUIRED QUIET CONFIG COMPONENTS OPTIONAL_COMPONENTS NO_DEFAULT_PATH PATHS HINTS NAMES PATH_SUFFIXES CACHE STRING BOOL PATH FILEPATH INTERNAL FORCE PARENT_SCOPE APPEND PREPEND REMOVE_ITEM TARGETS FILES DIRECTORY DESTINATION RUNTIME LIBRARY ARCHIVE INCLUDES EXPORT NAMESPACE COMPONENT PROPERTIES PROPERTY TARGET SOURCE TEST NAME COMMAND WORKING_DIRECTORY DEPENDS OUTPUT BYPRODUCTS COMMENT VERBATIM ALL POST_BUILD PRE_BUILD PRE_LINK GLOB GLOB_RECURSE CONFIGURE_DEPENDS READ WRITE STATUS WARNING AUTHOR_WARNING SEND_ERROR FATAL_ERROR DEPRECATION NOTICE VERBOSE DEBUG TRACE CHECK_START CHECK_PASS CHECK_FAIL AND OR NOT DEFINED EXISTS IS_DIRECTORY IS_ABSOLUTE STREQUAL STRLESS STRGREATER EQUAL LESS GREATER MATCHES VERSION_LESS VERSION_GREATER VERSION_EQUAL VERSION_LESS_EQUAL VERSION_GREATER_EQUAL IN_LIST POLICY BEFORE AFTER SYSTEM RANGE IN LISTS ITEMS ZIP_LISTS GIT_REPOSITORY GIT_TAG URL URL_HASH".split(
    " ",
  );
const BOOLEANS = new Set("ON OFF TRUE FALSE YES NO".split(" "));
export const VARIABLES =
  "CMAKE_SOURCE_DIR CMAKE_BINARY_DIR CMAKE_CURRENT_SOURCE_DIR CMAKE_CURRENT_BINARY_DIR CMAKE_CURRENT_LIST_DIR CMAKE_CURRENT_LIST_FILE PROJECT_NAME PROJECT_SOURCE_DIR PROJECT_BINARY_DIR PROJECT_VERSION CMAKE_PROJECT_NAME CMAKE_BUILD_TYPE CMAKE_CONFIGURATION_TYPES CMAKE_CXX_STANDARD CMAKE_CXX_STANDARD_REQUIRED CMAKE_CXX_EXTENSIONS CMAKE_C_STANDARD CMAKE_CXX_FLAGS CMAKE_C_FLAGS CMAKE_CXX_COMPILER CMAKE_C_COMPILER CMAKE_CXX_COMPILER_ID CMAKE_CXX_COMPILER_VERSION CMAKE_EXPORT_COMPILE_COMMANDS CMAKE_INSTALL_PREFIX CMAKE_MODULE_PATH CMAKE_PREFIX_PATH CMAKE_TOOLCHAIN_FILE CMAKE_RUNTIME_OUTPUT_DIRECTORY CMAKE_LIBRARY_OUTPUT_DIRECTORY CMAKE_ARCHIVE_OUTPUT_DIRECTORY CMAKE_POSITION_INDEPENDENT_CODE BUILD_SHARED_LIBS BUILD_TESTING CMAKE_SYSTEM_NAME CMAKE_SYSTEM_PROCESSOR CMAKE_HOST_SYSTEM_NAME WIN32 UNIX APPLE MSVC MINGW CMAKE_VERSION CMAKE_COMMAND CMAKE_GENERATOR CMAKE_CXX_VISIBILITY_PRESET CMAKE_VISIBILITY_INLINES_HIDDEN CMAKE_INTERPROCEDURAL_OPTIMIZATION CMAKE_DEBUG_POSTFIX CMAKE_INCLUDE_CURRENT_DIR CMAKE_AUTOMOC CMAKE_AUTORCC CMAKE_AUTOUIC CMAKE_COLOR_DIAGNOSTICS CMAKE_CXX_CLANG_TIDY CMAKE_SIZEOF_VOID_P".split(
    " ",
  );

interface State {
  /** Inside the parentheses of a command (nesting depth). */
  depth: number;
  /** In a bracket comment or argument: its `=` count, else -1. */
  bracket: number;
  comment: boolean;
  quoted: boolean;
}

/** `[[`, `[=[`…: the number of `=`, or -1. */
function openBracket(stream: StringStream): number {
  const match = stream.match(/^\[(=*)\[/);
  return match && typeof match !== "boolean" ? match[1].length : -1;
}
function closeBracket(stream: StringStream, state: State) {
  const end = `]${"=".repeat(state.bracket)}]`;
  while (!stream.eol()) {
    if (stream.match(end)) {
      state.bracket = -1;
      return;
    }
    stream.next();
  }
}
/** `${NAME}`, `$ENV{NAME}`, `$CACHE{NAME}` (possibly nested) or `$<…>`. */
function reference(stream: StringStream): string | null {
  if (stream.match(/^\$(ENV|CACHE)?\{/)) {
    let depth = 1;
    while (!stream.eol() && depth > 0) {
      const ch = stream.next();
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    return "cmakeVariable";
  }
  if (stream.match("$<")) {
    let depth = 1;
    while (!stream.eol() && depth > 0) {
      const ch = stream.next();
      if (ch === "<") depth++;
      else if (ch === ">") depth--;
    }
    return "cmakeGenerator";
  }
  return null;
}

const parser: StreamParser<State> = {
  name: "cmake",
  startState: () => ({ depth: 0, bracket: -1, comment: false, quoted: false }),
  copyState: (state) => ({ ...state }),
  token(stream, state) {
    if (state.bracket >= 0) {
      closeBracket(stream, state);
      return state.comment ? "comment" : "string";
    }
    if (state.quoted) {
      if (stream.peek() === "$") {
        const kind = reference(stream);
        if (kind) return kind;
      }
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === "\\") stream.next();
        else if (ch === '"') {
          state.quoted = false;
          break;
        } else if (stream.peek() === "$") break;
      }
      return "string";
    }
    if (stream.eatSpace()) return null;
    if (stream.peek() === "#") {
      stream.next();
      const level = openBracket(stream);
      if (level >= 0) {
        state.bracket = level;
        state.comment = true;
        closeBracket(stream, state);
      } else stream.skipToEnd();
      return "comment";
    }
    if (stream.peek() === "[") {
      const level = openBracket(stream);
      if (level >= 0) {
        state.bracket = level;
        state.comment = false;
        closeBracket(stream, state);
        return "string";
      }
    }
    if (stream.peek() === '"') {
      stream.next();
      state.quoted = true;
      return "string";
    }
    if (stream.peek() === "$") {
      const kind = reference(stream);
      if (kind) return kind;
    }
    const ch = stream.next()!;
    if (ch === "(") {
      state.depth++;
      return "paren";
    }
    if (ch === ")") {
      state.depth = Math.max(0, state.depth - 1);
      return "paren";
    }
    if (/[A-Za-z_]/.test(ch)) {
      stream.eatWhile(/[\w.+-]/);
      const word = stream.current();
      if (state.depth === 0) {
        if (!stream.match(/^\s*\(/, false)) return null;
        return CONTROL.has(word.toLowerCase())
          ? "cmakeControl"
          : "cmakeCommand";
      }
      if (BOOLEANS.has(word.toUpperCase())) return "bool";
      if (KEYWORD_SET.has(word)) return "keyword";
      return null;
    }
    if (/\d/.test(ch)) {
      stream.eatWhile(/[\d.]/);
      return "number";
    }
    return null;
  },
  languageData: { commentTokens: { line: "#" } },
  // Own names: the standard ones (variable…) would win over this table.
  tokenTable: {
    cmakeCommand: tags.function(tags.variableName),
    cmakeControl: tags.controlKeyword,
    cmakeVariable: tags.special(tags.variableName),
    cmakeGenerator: tags.meta,
  },
};
const KEYWORD_SET = new Set(KEYWORDS);

export const cmakeLanguage = StreamLanguage.define(parser);

/** What the file defines: targets, variables and its own functions and macros. */
export function definitions(text: string) {
  const targets = new Set<string>(),
    variables = new Set<string>(),
    commands = new Set<string>();
  const pattern =
    /^[ \t]*(add_executable|add_library|add_custom_target|set|option|function|macro)[ \t]*\([ \t]*([A-Za-z_][\w.+-]*)/gim;
  for (const [, command, name] of text.matchAll(pattern)) {
    const kind = command.toLowerCase();
    if (kind === "set" || kind === "option") variables.add(name);
    else if (kind === "function" || kind === "macro") commands.add(name);
    else targets.add(name);
  }
  return { targets, variables, commands };
}

/** Where the cursor is: a command name, a `${` variable or a command's arguments. */
export function place(before: string): "command" | "variable" | "argument" {
  if (/\$(ENV|CACHE)?\{[\w.+-]*$/.test(before)) return "variable";
  let depth = 0,
    quoted = false;
  for (let i = 0; i < before.length; i++) {
    const ch = before[i];
    if (quoted) {
      if (ch === "\\") i++;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === "#") {
      const end = before.indexOf("\n", i);
      if (end < 0) break;
      i = end;
    } else if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
  }
  return depth > 0 ? "argument" : "command";
}

function complete(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[\w.+-]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  const doc = context.state.doc;
  const before = doc.sliceString(Math.max(0, word.to - 20_000), word.to);
  const where = place(before);
  const own = definitions(doc.toString());
  const list = (labels: Iterable<string>, type: string, boost = 0) =>
    [...labels].map((label): Completion => ({ label, type, boost }));
  let options: Completion[];
  if (where === "variable")
    options = [
      ...list(own.variables, "variable", 1),
      ...list(VARIABLES, "variable"),
    ];
  else if (where === "command")
    options = [
      ...list(own.commands, "function", 1),
      ...list(COMMANDS, "function"),
    ];
  else
    options = [
      ...list(own.targets, "class", 2),
      ...list(KEYWORDS, "keyword", 1),
      ...list(own.variables, "variable"),
      ...list(VARIABLES, "variable", -1),
    ];
  // A name defined in the file and also known to CMake is offered once.
  const seen = new Set<string>();
  options = options.filter((o) => !seen.has(o.label) && seen.add(o.label));
  return { from: word.from, options, validFor: /^[\w.+-]*$/ };
}

/** CMake highlighting and completion for CMakeLists.txt and *.cmake files. */
export function cmake() {
  return [cmakeLanguage, cmakeLanguage.data.of({ autocomplete: complete })];
}
