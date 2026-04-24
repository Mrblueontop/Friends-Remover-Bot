// ─────────────────────────────────────────────────────────────────────────────
// Friends Remover X — Roblox API Helpers
// ─────────────────────────────────────────────────────────────────────────────

export interface RobloxUser {
  id: number;
  name: string;
  displayName: string;
}

/** Look up a Roblox user by username. Returns null if not found. */
export async function getUserByUsername(username: string): Promise<RobloxUser | null> {
  try {
    const res = await fetch("https://users.roblox.com/v1/usernames/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data: RobloxUser[] };
    return data.data[0] ?? null;
  } catch {
    return null;
  }
}

/** Fetch the bio/description of a Roblox user by their numeric ID. */
export async function getUserBio(userId: number): Promise<string> {
  try {
    const res = await fetch(`https://users.roblox.com/v1/users/${userId}`);
    if (!res.ok) return "";
    const data = (await res.json()) as { description?: string };
    return data.description ?? "";
  } catch {
    return "";
  }
}

/** Generate a short random verification code to place in a Roblox bio. */
export function generateCode(): string {
  return "FRX-" + Math.random().toString(36).slice(2, 8).toUpperCase();
}
