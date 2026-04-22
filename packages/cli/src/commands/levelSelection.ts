import type { Command } from 'commander'
import chalk from 'chalk'
import { EXIT_CODES } from '@investec-game/shared'
import { getCurrentLevelCoordinates, setCurrentLevel } from '../db/progress.js'

interface LevelSelectionOptions {
  season?: string
  level?: string
}

interface LevelSelection {
  season: number
  level: number
}

export function resolveLevelSelection(program: Command, opts: LevelSelectionOptions): LevelSelection {
  const hasSeason = opts.season !== undefined
  const hasLevel = opts.level !== undefined

  if (hasSeason !== hasLevel) {
    program.error(
      chalk.red('Provide both --season and --level together, or omit both to use the active level.'),
      { exitCode: EXIT_CODES.USAGE_ERROR, code: 'game.selection.missing-pair' }
    )
  }

  if (hasSeason && hasLevel) {
    const season = Number.parseInt(opts.season ?? '', 10)
    const level = Number.parseInt(opts.level ?? '', 10)

    if (!Number.isFinite(season) || season <= 0) {
      program.error(chalk.red(`Invalid season: ${opts.season}`), {
        exitCode: EXIT_CODES.USAGE_ERROR,
        code: 'game.selection.invalid-season',
      })
    }
    if (!Number.isFinite(level) || level <= 0) {
      program.error(chalk.red(`Invalid level: ${opts.level}`), {
        exitCode: EXIT_CODES.USAGE_ERROR,
        code: 'game.selection.invalid-level',
      })
    }

    setCurrentLevel(`s${season}-l${level}`)

    return { season, level }
  }

  const current = getCurrentLevelCoordinates()
  if (!current) {
    program.error(
      chalk.red(
        'No active level selected. Run `pnpm game level <number> --season <number>` first, or pass --season and --level.'
      ),
      { exitCode: EXIT_CODES.USAGE_ERROR, code: 'game.selection.no-active-level' }
    )
  }

  return current
}
