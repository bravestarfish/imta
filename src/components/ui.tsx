import type { ReactNode } from "react";

export function Avatar({ user, size = 32 }: { user: { avatarUrl?: string | null; handle: string; displayName?: string | null }; size?: number }) {
  const initial = (user.displayName ?? user.handle).slice(0, 1).toUpperCase();
  if (user.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={user.avatarUrl} alt="" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span className="inline-flex items-center justify-center rounded-full bg-accent/15 text-accent" style={{ width: size, height: size, fontSize: size * 0.45 }}>
      {initial}
    </span>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card border-dashed text-center text-sm text-muted">{children}</div>;
}

export function Notice({ kind = "info", children }: { kind?: "info" | "error" | "success"; children: ReactNode }) {
  const cls =
    kind === "error"
      ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
      : kind === "success"
        ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
        : "border-border bg-card text-foreground";
  return <div className={`mb-4 rounded-md border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "warn" | "danger" | "ok" }) {
  const cls = {
    neutral: "bg-border/60 text-foreground",
    accent: "bg-accent/15 text-accent",
    warn: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200",
    danger: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200",
    ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
  }[tone];
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

export const TIMEZONES: string[] = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];

export function TimezoneSelect({ name, defaultValue, id }: { name: string; defaultValue?: string; id?: string }) {
  return (
    <select name={name} id={id} defaultValue={defaultValue ?? "UTC"} className="input">
      {!TIMEZONES.includes("UTC") ? <option value="UTC">UTC</option> : null}
      {TIMEZONES.map((tz) => (
        <option key={tz} value={tz}>
          {tz.replace(/_/g, " ")}
        </option>
      ))}
    </select>
  );
}

export function SubmitButton({ children, className = "btn-primary", formAction, name, value }: { children: ReactNode; className?: string; formAction?: (formData: FormData) => void | Promise<void>; name?: string; value?: string }) {
  return (
    <button type="submit" className={className} formAction={formAction} name={name} value={value}>
      {children}
    </button>
  );
}
