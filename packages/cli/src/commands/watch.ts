import type { Command } from 'commander'
import { existsSync } from 'fs'
import { relative } from 'path'
import chalk from 'chalk'
import ora from 'ora'
import chokidar from 'chokidar'
import { EXIT_CODES } from '@investec-game/shared'
import { findLevelDir, loadLevel } from '../levels/loader.js'
import { ensureApiRunning } from '../services/apiProcess.js'
import { runLevelEvaluation } from './test.js'
import { resolveLevelSelection } from './levelSelection.js'

export function registerWatchCommand(program: Command): void {
  program
    .command('watch')
    .description('Watch level files and re-run tests + attack script on save')
    .option('-s, --season <n>', 'Season number')
    .option('-l, --level <n>', 'Level number')
    .option('-d, --debounce <ms>', 'Debounce delay in ms', '300')
    .action(async (opts: { season?: string; level?: string; debounce: string }) => {
      const { season, level } = resolveLevelSelection(program, opts)
      const parsedDebounce = parseInt(opts.debounce, 10)
      const debounceMs = Number.isFinite(parsedDebounce)
        ? Math.max(parsedDebounce, 0)
        : 300

      if (!Number.isFinite(parsedDebounce) || parsedDebounce < 0) {
        program.error(chalk.red(`Invalid debounce value: ${opts.debounce}`), {
          exitCode: EXIT_CODES.USAGE_ERROR,
          code: 'game.watch.invalid-debounce',
        })
      }

      const levelDir = findLevelDir(season, level)
      if (!levelDir) {
        program.error(chalk.red(`Level S${season}L${level} not found.`), {
          exitCode: EXIT_CODES.USAGE_ERROR,
          code: 'game.watch.not-found',
        })
      }

      const resolved = loadLevel(levelDir)
      const { manifest, solutionPath, testsDir, attackDir, dir } = resolved

      if (!existsSync(solutionPath)) {
        program.error(
          chalk.red(`No solution.js found. Run: pnpm game level ${level} --season ${season}`),
          { exitCode: EXIT_CODES.USAGE_ERROR, code: 'game.watch.no-solution' }
        )
      }

      if (manifest.apiRequired) {
        const apiSpinner = ora('Starting mock Investec API…').start()
        try {
          await ensureApiRunning()
          apiSpinner.succeed('Mock Investec API is running')
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to start mock API'
          apiSpinner.fail(msg)
          program.error(chalk.red(msg), {
            exitCode: EXIT_CODES.USAGE_ERROR,
            code: 'game.watch.api-start-failed',
          })
        }
      }

      console.log(chalk.bold(`\nWatching: ${manifest.name}`))
      console.log(chalk.dim(`Files: solution.js, tests/, attack/`))
      console.log(chalk.dim(`Debounce: ${debounceMs}ms`))
      console.log(chalk.dim('Press Ctrl+C to stop.\n'))

      let inFlight = false
      let rerunQueued = false
      let pendingReason = 'initial run'
      let debounceTimer: NodeJS.Timeout | null = null

      const runCycle = async (reason: string): Promise<void> => {
        if (inFlight) {
          rerunQueued = true
          pendingReason = reason
          return
        }

        inFlight = true
        console.log(chalk.cyan(`\n[${new Date().toLocaleTimeString()}] Re-running (${reason})\n`))

        try {
          await runLevelEvaluation(resolved, {
            countAttempt: false,
            showWinBanner: true,
          })
        } finally {
          inFlight = false
          if (rerunQueued) {
            rerunQueued = false
            await runCycle(pendingReason)
          }
        }
      }

      const schedule = (reason: string): void => {
        pendingReason = reason
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          void runCycle(reason)
        }, debounceMs)
      }

      const eventPathLabel = (path: string): string => {
        const rel = relative(dir, path)
        return rel.length > 0 ? rel : path
      }

      const watcher = chokidar.watch([solutionPath, testsDir, attackDir], {
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 200,
          pollInterval: 100,
        },
      })

      watcher.on('change', (path) => schedule(`changed ${eventPathLabel(path)}`))
      watcher.on('add', (path) => schedule(`added ${eventPathLabel(path)}`))
      watcher.on('unlink', (path) => schedule(`removed ${eventPathLabel(path)}`))
      watcher.on('error', (error) => {
        const msg = error instanceof Error ? error.message : String(error)
        console.error(chalk.red(`Watcher error: ${msg}`))
      })

      await runCycle('initial run')

      await new Promise<void>((resolve) => {
        let closing = false

        const close = async () => {
          if (closing) return
          closing = true
          if (debounceTimer) clearTimeout(debounceTimer)
          await watcher.close()
          console.log(chalk.dim('\nStopped watch mode.'))
          resolve()
        }

        process.once('SIGINT', () => {
          void close()
        })
        process.once('SIGTERM', () => {
          void close()
        })
      })
    })
}
