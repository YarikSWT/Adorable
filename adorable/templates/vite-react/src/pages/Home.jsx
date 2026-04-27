import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-xl text-center space-y-6">
        <div className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-1.5 text-sm text-accent-foreground">
          <Sparkles className="w-4 h-4" />
          <span>Built with Adorable</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
          Your app starts here
        </h1>
        <p className="text-muted-foreground text-lg">
          This is a Vite + React + Tailwind boilerplate. Ask Adorable to change
          this page, add routes, or build a feature — your edits show up live.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Button>Get started</Button>
          <Button variant="outline">Read docs</Button>
        </div>
      </div>
    </main>
  );
}
