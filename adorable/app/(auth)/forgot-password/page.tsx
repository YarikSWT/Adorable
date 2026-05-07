import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Восстановление пароля"
      footer={
        <Link
          href="/login"
          className="font-medium text-primary hover:underline"
        >
          Назад ко входу
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
