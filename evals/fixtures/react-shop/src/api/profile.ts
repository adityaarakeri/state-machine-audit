export interface Profile {
  id: string;
  name: string;
}

export async function getProfile(userId: string): Promise<Profile> {
  const res = await fetch(`/api/users/${userId}`);
  if (res.status === 401) {
    localStorage.removeItem("token");
    throw new Error("Unauthorized");
  }
  return res.json();
}
