import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/session";
import LoginForm from "@/components/LoginForm";

export default async function Landing() {
  if (await currentUserId()) redirect("/home");
  return <LoginForm />;
}
