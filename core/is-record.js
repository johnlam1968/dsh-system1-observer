// NARROWING HELPERS FOR DATA THAT CROSSES A RUNTIME BOUNDARY.
//
// THE REPOSITORY RULE (`AGENTS.md`): such data is narrowed by property check and never by an `as`. These are
// what that looks like written once instead of at each call site — each is a TYPE PREDICATE whose body is the
// property check, which is the only form in which TypeScript can narrow a value it knows nothing about.
//
// WHY THIS FILE EXISTS SEPARATELY FROM `sql.ts`, and it is not tidiness — it is a measured structural fact.
// `isRecord` was in `src/types/sql.ts` beside `bound`, which genuinely needs `node:sqlite`'s `SQLInputValue`.
// **30 files import `isRecord` and only 2 import `bound`**, so a module named for SQL was the stated
// dependency of 30 files that have nothing to do with SQL at all.
//
// The cost of that was invisible until this repository was about to be split into a runtime and an
// application. Asking "which modules depend on a database?" answered `src/model/` 6 of 7 files and
// `src/guard/` 2 of 4 — alarming, and false. Every one of those was importing this function from a FILE
// NAMED AFTER SQL. A runtime repo cannot be extracted while its own file layout claims that dependency, and
// a reviewer cannot audit a boundary that the filenames misreport.
//
// So: nothing here mentions SQL, and `sql.ts` keeps only what does.
//
// A `.ts` and not a `.d.ts` because these carry runtime code, and because a `.d.ts` cannot hold an
// implementation the freshness gate can compare.
/** A JSON-shaped object: not null, an object, and not an array. */
export function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
