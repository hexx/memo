import { createRootRoute, Outlet, Link } from "@tanstack/react-router";
import { FileText, Archive, Tag } from "lucide-react";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto flex h-14 items-center px-4">
          <Link to="/" className="font-bold text-lg mr-8">
            Org Memo
          </Link>
          <nav className="flex gap-4 text-sm text-muted-foreground">
            <Link
              to="/"
              className="flex items-center gap-1 hover:text-foreground transition-colors [&.active]:text-foreground [&.active]:font-semibold"
            >
              <FileText className="h-4 w-4" />
              メモ
            </Link>
            <Link
              to="/archive"
              className="flex items-center gap-1 hover:text-foreground transition-colors [&.active]:text-foreground [&.active]:font-semibold"
            >
              <Archive className="h-4 w-4" />
              アーカイブ
            </Link>
            <Link
              to="/labels"
              className="flex items-center gap-1 hover:text-foreground transition-colors [&.active]:text-foreground [&.active]:font-semibold"
            >
              <Tag className="h-4 w-4" />
              ラベル
            </Link>
          </nav>
        </div>
      </header>
      <main className="container mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
