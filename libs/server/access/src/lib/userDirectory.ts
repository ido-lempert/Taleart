import type { AdminUser, AdminUserList } from '@taleart/contract';
import type { Db } from './db';

/** How many users the admin's list holds at most; one more row tells whether the list was cut short. */
export const USER_DIRECTORY_LIMIT = 500;

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: AdminUser['role'];
  createdAt: Date;
  passkey: boolean;
  password: boolean;
  identities: string[] | null;
  projects: number;
}

/**
 * The install's users for an admin (Users page): the sign-in methods each one holds, never a hash, a
 * secret or a username. Ordered by creation and then id, a total order. `projects` counts the projects
 * the user is a member of (admins reach every project whether or not they are members).
 */
export async function listUsers(db: Db): Promise<AdminUserList> {
  const { rows } = await db.query<UserRow>(
    `SELECT u.id, u.name, u.email, u.role, u.created_at AS "createdAt",
            EXISTS (SELECT 1 FROM passkeys p WHERE p.user_id = u.id) AS passkey,
            EXISTS (SELECT 1 FROM user_passwords pw WHERE pw.user_id = u.id) AS password,
            ARRAY(SELECT DISTINCT i.provider FROM user_identities i WHERE i.user_id = u.id ORDER BY i.provider) AS identities,
            (SELECT count(*)::int FROM project_members m WHERE m.user_id = u.id) AS projects
       FROM users u
      ORDER BY u.created_at, u.id
      LIMIT $1`,
    [USER_DIRECTORY_LIMIT + 1],
  );
  const users: AdminUser[] = rows.slice(0, USER_DIRECTORY_LIMIT).map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    methods: {
      passkey: row.passkey,
      password: row.password,
      identities: row.identities ?? [],
    },
    projects: row.projects,
  }));
  return { users, truncated: rows.length > USER_DIRECTORY_LIMIT };
}
