# 035 — Calculator

The user asked for a calculator module after V0.8: Windows Calculator's Scientific and
Programmer modes, with on-screen keys and the keyboard. No plan file describes it; this
record is its specification. It extends the product boundary "no other post-V0.8 modules"
by this one module, on purpose.

## Scope

- **Calculator** is a launcher entry like the Terminal: any number of panels, as tabs, splits
  or floating panels. Each instance has its own state.
- Two modes, each with its own expression, history and memory. Switching modes does not
  clear either one. **Scientific** has doubles, an angle unit (DEG/RAD/GRAD), `2nd` (x³, ∛x,
  ʸ√x, 2ˣ, logᵧx, eˣ, ⌈x⌉, inverse trigonometry) and `hyp`. **Programmer** has integers of a
  word size (QWORD/DWORD/WORD/BYTE) in two's complement, HEX/DEC/OCT/BIN input, the value
  shown in all four bases, and AND, OR, XOR, NAND, NOR, NOT, <<, >> (arithmetic), RoL and
  RoR.
- Not included: Standard mode (Scientific covers it), graphing, date calculation, unit
  conversion, variables, the bit-toggling keypad, logical and rotate-through-carry shift
  modes, and a font or size setting of its own.

## Decisions

- **Nothing is saved.** History and memory last while the panel does. Mozaik never restores
  a layout at startup, and a calculator has no user data worth recovering. So it has no
  Rust, no IPC and no files.
- **No `eval`.** Keys build a list of values, operators and open parentheses
  (`engine.ts`), and a shunting-yard reduction applies precedence. A closed group becomes a
  value at once. Groups still open at `=` close there. Both modes share this engine through
  a `Kind` (`number` or `bigint`).
- **Windows Calculator's behaviour where it is clear:** precedence (`2+3×4 = 14`, `^`
  right-associative), functions applied to the shown value and written around it
  (`sin(30)`), an operator after an operator replaces it, a digit after `=` starts again,
  and an operator continues from the result. Errors are "Cannot divide by zero", "Result is
  undefined", "Invalid input" and "Overflow". In degrees, sin 180° is 0 and tan 90° is
  invalid. Results show 15 significant digits, with an exponent from 10¹⁶ on.
- **Programmer numbers are `bigint`s** wrapped with `BigInt.asIntN`. DEC shows them signed,
  and the other bases show their bits. A digit that would not fit in the word is not taken.
  A smaller word size cuts every value, as Windows does. Precedence follows C (`*` over `+`
  over shifts over AND over XOR over OR).
- **Keys:** typed characters follow the layout (`keys.ts`). A numeric keypad's decimal comma
  is the decimal point. The Scientific letters are Windows': S sin, O cos, T tan, L log,
  N ln, Q x², R 1/x, @ √x, P π, `!`, and `^`/Y for powers. `%` is mod in both modes. In
  Programmer, `^` is XOR, and `& | ~ < >` are the bitwise keys. Enter or `=` gives the
  result, Escape clears, Delete clears the entry and Backspace erases a digit. These keys
  are rebindable in Settings → Calculator: Alt+2 Scientific, Alt+4 Programmer (Windows'
  keys), F5–F8 for the bases, F9 to change the sign, Ctrl+C to copy the result and Ctrl+V to
  paste. A paste types its first line key by key, so a number or an expression works. The
  debug keys leave a focused calculator alone, as they do a terminal.
- A click keeps the keyboard focus on the panel, so Enter stays `=` after a key was
  clicked.
- **Floating size:** a new floating Calculator opens compact, at most 300×440 (its plugin's
  `float` size, never under its 260×360 minimum), so only the keys show and History/Memory
  stay behind their toggle; it can still be resized at its edges.
