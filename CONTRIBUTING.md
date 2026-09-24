# Contributing

## Development

Requires Node.js 22 or newer.

```sh
npm ci
npm test
npm run check
```

Please add a fixture-backed test for behavior changes. Keep the checker read-only and do not invoke commands found in the workspace configuration.

## Scope

This project checks relationships that can be established from local VS Code configuration files. It cannot enumerate arbitrary tasks contributed by installed extensions, so unresolved task references must remain warnings by default unless the input syntax makes their absence certain.
