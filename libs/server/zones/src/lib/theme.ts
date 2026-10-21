import {
  cleanThemeSettings,
  ErrorCodes,
  resolveTheme,
  themeSettingsError,
  type ProjectTheme,
  type ThemeSettings,
} from '@taleart/contract';
import type { Db } from '@taleart/server-access';

/** Thrown when a theme does not match the theme schema (epic web zones R9). */
export class InvalidThemeError extends Error {
  readonly code = ErrorCodes.invalidTheme;

  constructor(message: string) {
    super(message);
    this.name = 'InvalidThemeError';
  }
}

// The stored fields, cleaned, and the complete theme they resolve to.
function projectTheme(projectId: string, stored: unknown): ProjectTheme {
  const theme = cleanThemeSettings(stored);
  return { projectId, theme, resolved: resolveTheme(theme) };
}

/**
 * The project's theme: the fields it sets and the complete theme with
 * TaleArt's defaults filled in. A project with no theme row has `{}`. Stored
 * fields that fail the schema (written by hand, or before a rule changed) are
 * dropped, so they never reach the dashboard or an SDK. The caller checks the
 * project exists.
 */
export async function getProjectTheme(db: Db, projectId: string): Promise<ProjectTheme> {
  const { rows } = await db.query<{ theme: unknown }>('SELECT theme FROM project_themes WHERE project_id = $1', [
    projectId,
  ]);
  return projectTheme(projectId, rows[0]?.theme ?? {});
}

/**
 * Replaces the project's theme with `settings`, which must match the theme
 * schema (unknown fields refused); nothing is stored otherwise. `{}` resets
 * the theme to TaleArt's default. The caller checks the project exists.
 */
export async function setProjectTheme(db: Db, projectId: string, settings: unknown): Promise<ProjectTheme> {
  const error = themeSettingsError(settings);
  if (error) throw new InvalidThemeError(error);
  const theme = settings as ThemeSettings;
  await db.query(
    `INSERT INTO project_themes (project_id, theme) VALUES ($1, $2)
     ON CONFLICT (project_id) DO UPDATE SET theme = EXCLUDED.theme, updated_at = now()`,
    [projectId, JSON.stringify(theme)],
  );
  return projectTheme(projectId, theme);
}
