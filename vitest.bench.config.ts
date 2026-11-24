import { configDefaults, defineConfig } from 'vitest/config'

// noseFlick.report.ts is an owner file awaiting a port to the current flight cores;
// it no longer typechecks against PilotCommand, so it is excluded here and in tsconfig.json.
export default defineConfig({ test: { testTimeout: 30000, include: ['benchmarks/**/*.report.ts'], exclude: [...configDefaults.exclude, 'benchmarks/flight/noseFlick.report.ts'] } })
