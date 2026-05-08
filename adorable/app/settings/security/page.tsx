import { SecurityClient } from "./security-client";

export default function SecurityPage() {
  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-lg font-semibold">Безопасность</h1>
      <SecurityClient />
    </div>
  );
}
