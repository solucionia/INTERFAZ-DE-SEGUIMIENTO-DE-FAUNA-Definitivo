import { Link, useLocation } from "wouter";
import { ChevronRight, Home } from "lucide-react";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground mb-4 flex-wrap" data-testid="nav-breadcrumbs">
      <Link href="/">
        <span className="hover:text-foreground cursor-pointer flex items-center gap-1">
          <Home className="w-3.5 h-3.5" />
          <span>Inicio</span>
        </span>
      </Link>
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1">
          <ChevronRight className="w-3.5 h-3.5" />
          {item.href ? (
            <Link href={item.href}>
              <span className="hover:text-foreground cursor-pointer">{item.label}</span>
            </Link>
          ) : (
            <span className="text-foreground font-medium">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
