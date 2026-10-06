import { type DeepReadonly, type User } from "../domain/types";
export interface DemoUser { id: string; name: string; fullName: string; firstName: string; lastName: string; imageUrl: string }
export function demoIdentity(user: DeepReadonly<User>): DemoUser {
  const [firstName = "", ...rest] = user.name.split(" ");
  return { id: user.id, name: user.name, fullName: user.name, firstName, lastName: rest.join(" "), imageUrl: user.avatarPath };
}
