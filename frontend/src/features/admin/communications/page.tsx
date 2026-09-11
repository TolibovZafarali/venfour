import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { isPermanentAuthState, useAuth } from "@/features/auth";
import {
  communicationsService,
  type EmailAutomation,
  type EmailPreview,
  type EmailTemplate,
} from "./service";
import "./styles.css";

function label(value: string) {
  return value.replaceAll("_", " ").replace(/^email\./, "");
}
function date(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "Not yet";
}

export function AdminCommunicationsPage() {
  const { auth } = useAuth();
  if (!isPermanentAuthState(auth))
    return (
      <section className="admin-page">
        <h1>Communications</h1>
        <p>Sign in to your staff account.</p>
      </section>
    );
  return (
    <CommunicationsContent
      key={auth.user.id}
      userId={auth.user.id}
      token={auth.session.access_token}
    />
  );
}

function CommunicationsContent({
  userId,
  token,
}: {
  userId: string;
  token: string;
}) {
  const client = useQueryClient();
  const [selection, setSelection] = useState("paid_review_ready");
  const [tab, setTab] = useState<"designs" | "automations" | "activity">(
    "designs",
  );
  const [notice, setNotice] = useState("");
  const root = ["communications", userId];
  const query = useQuery({
    queryKey: root,
    queryFn: ({ signal }) => communicationsService.overview(token, signal),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchInterval: 30000,
  });
  const mutation = useMutation({
    mutationFn: ({
      action,
      payload,
    }: {
      action: string;
      payload: Record<string, unknown>;
    }) => communicationsService.operation(token, action, payload),
    onSuccess: async () => {
      setNotice("Saved.");
      await client.invalidateQueries({ queryKey: root });
    },
  });
  const plan = useMutation({
    mutationFn: () =>
      communicationsService.operation<{
        counts: { template_key: string; count: number }[];
      }>(token, "plan", {}),
  });
  if (query.isPending)
    return (
      <section className="admin-page">
        <h1>Communications</h1>
        <p role="status">Loading email settings…</p>
      </section>
    );
  if (query.isError || !query.data)
    return (
      <section className="admin-page">
        <h1>Communications</h1>
        <p role="alert">
          Email settings are unavailable or your staff access has changed.
        </p>
        <Button onClick={() => void query.refetch()}>Try again</Button>
      </section>
    );
  const data = query.data;
  const selected =
    data.templates.find((item) => item.key === selection) ?? data.templates[0];
  const activity = [
    ...data.activity,
    ...data.partner_activity,
    ...data.preview_activity,
  ].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (
    <section className="admin-page communications-page">
      <header className="communications-header">
        <div>
          <p className="communications-eyebrow">CUSTOMER CARE</p>
          <h1>Communications</h1>
          <p>Thoughtful emails, tied to real customer progress.</p>
        </div>
        <Button variant="outline" onClick={() => void query.refetch()}>
          Refresh
        </Button>
      </header>
      <div className="communications-summary">
        <article>
          <span>Customer automations</span>
          <strong>
            {data.settings.mode === "live"
              ? "Enabled"
              : data.settings.mode === "dry_run"
                ? "Dry run"
                : "Paused"}
          </strong>
          <small>
            Sending also requires an active transport and scheduler.
          </small>
        </article>
        <article>
          <span>Delivery transport</span>
          <strong>{label(data.configuration.provider)}</strong>
          <small>
            {data.configuration.mode === "allowlist"
              ? "Approved test recipients only"
              : `Environment: ${label(data.configuration.mode)}`}
          </small>
        </article>
        <article>
          <span>Auth hook endpoint</span>
          <strong>
            {data.configuration.auth_hook_enabled ? "Enabled" : "Disabled"}
          </strong>
          <small>
            {data.configuration.auth_hook_enabled
              ? "Delivery also requires enabling this hook in Supabase."
              : "Supabase Auth settings choose the active sending route."}
          </small>
        </article>
      </div>
      {data.configuration.error && (
        <p className="communications-note" role="alert">
          Sender configuration needs attention before shared email delivery can
          run.
        </p>
      )}
      <div className="communications-tabs" aria-label="Communications views">
        {(["designs", "automations", "activity"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {value === "designs"
              ? "Designs & senders"
              : value === "automations"
                ? "Automations"
                : "Delivery activity"}
          </button>
        ))}
      </div>
      {tab === "designs" && (
        <>
          <div className="communications-identities">
            {data.configuration.identities.map((identity) => (
              <article className="communications-card" key={identity.name}>
                <h2>{label(identity.name)} emails</h2>
                <dl>
                  <dt>From</dt>
                  <dd>{identity.from || "Not configured"}</dd>
                  <dt>Reply to</dt>
                  <dd>{identity.reply_to || "Not configured"}</dd>
                </dl>
              </article>
            ))}
          </div>
          <p className="communications-note">
            Sender identities are configured in the server environment. Shared
            designs are versioned in the repository and published with
            application releases. The SMTP fallback uses the templates saved in
            Supabase.
          </p>
          <div className="communications-preview-layout">
            <div className="communications-card">
              <h2>Email library</h2>
              <label htmlFor="email-template">Choose an email</label>
              <select
                id="email-template"
                value={selected?.key ?? ""}
                onChange={(event) => setSelection(event.target.value)}
              >
                {data.templates.map((template) => (
                  <option value={template.key} key={template.key}>
                    {template.subject} · {label(template.key)}
                  </option>
                ))}
              </select>
              {selected && (
                <>
                  <p>{selected.trigger}</p>
                  <p className="communications-meta">
                    {label(selected.category)} · Layout {selected.version}
                  </p>
                  <p>
                    Previews use fictional data. Test sends go only to your
                    verified staff email when it is on the environment’s
                    approved test list.
                  </p>
                </>
              )}
            </div>
            {selected && (
              <TemplatePreview
                key={`${selected.key}:${userId}`}
                template={selected}
                token={token}
                userId={userId}
                testConfigured={data.configuration.test_send_configured}
              />
            )}
          </div>
        </>
      )}
      {tab === "automations" && (
        <>
          <article className="communications-card">
            <h2>Rollout controls</h2>
            <p>
              First activation includes only cases created after activation.
              Pausing preserves delivery history. Dry runs count eligible
              messages and send nothing.
            </p>
            <p>
              Enrollment begins:{" "}
              <strong>{date(data.settings.enrolled_after)}</strong>
            </p>
            <div className="communications-actions">
              {(["disabled", "dry_run", "live"] as const).map((mode) => (
                <Button
                  key={mode}
                  variant={data.settings.mode === mode ? "default" : "outline"}
                  disabled={mutation.isPending || data.settings.mode === mode}
                  onClick={() =>
                    mutation.mutate({
                      action: "settings",
                      payload: { mode, revision: data.settings.revision },
                    })
                  }
                >
                  {mode === "disabled"
                    ? "Pause"
                    : mode === "dry_run"
                      ? "Use dry run"
                      : "Enable for new cases"}
                </Button>
              ))}
              <Button
                variant="outline"
                disabled={plan.isPending}
                onClick={() => plan.mutate()}
              >
                Count eligible emails
              </Button>
            </div>
            {plan.data && (
              <p role="status">
                {plan.data.counts.reduce((sum, row) => sum + row.count, 0)}{" "}
                currently eligible messages. No emails sent by this count.
              </p>
            )}
            {plan.isError && (
              <p role="alert">Could not count eligible emails. Try again.</p>
            )}
          </article>
          <p className="communications-note">
            Optional reminders require current consent and stop when the
            customer progresses. Limits: one per 24 hours, at most three per
            seven days across a recipient’s cases. No sales campaigns are
            enabled.
          </p>
          <div className="communications-automation-list">
            {data.automations.map((automation) => (
              <AutomationCard
                key={`${automation.template_key}:${automation.revision}`}
                automation={automation}
                template={data.templates.find(
                  (t) => t.key === automation.template_key,
                )}
                busy={mutation.isPending}
                save={(payload) =>
                  mutation.mutate({ action: "automation", payload })
                }
              />
            ))}
          </div>
        </>
      )}
      {tab === "activity" && (
        <article className="communications-card">
          <h2>Recent delivery activity</h2>
          <p>
            Provider acceptance and delivery are separate. Customer addresses,
            case content, tokens and credentials are omitted.
          </p>
          <p>
            {data.configuration.webhook_configured
              ? "Delivery webhook configured."
              : "Delivery webhook is not configured; inbox delivery cannot be confirmed."}{" "}
            {data.suppression_count} suppressed recipients.
          </p>
          {activity.length ? (
            <div className="communications-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Attempts</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.map((row) => (
                    <tr key={`${row.source}:${row.id}`}>
                      <td>
                        {label(row.template_key)}
                        {row.error_code && (
                          <small>{label(row.error_code.toLowerCase())}</small>
                        )}
                      </td>
                      <td>{label(row.source)}</td>
                      <td>
                        {row.delivery_status
                          ? label(row.delivery_status)
                          : row.status === "sent" || row.status === "completed"
                            ? "Provider accepted"
                            : label(row.status)}
                      </td>
                      <td>{row.attempts}</td>
                      <td>{date(row.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No delivery activity yet.</p>
          )}
        </article>
      )}
      {mutation.isError && (
        <p role="alert">
          Could not save. Refresh to check for a newer version, then try again.
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

function AutomationCard({
  automation,
  template,
  busy,
  save,
}: {
  automation: EmailAutomation;
  template?: EmailTemplate;
  busy: boolean;
  save: (payload: Record<string, unknown>) => void;
}) {
  const [enabled, setEnabled] = useState(automation.enabled);
  const [minutes, setMinutes] = useState(String(automation.delay_seconds / 60));
  const seconds = Number(minutes) * 60;
  const valid =
    minutes.trim() !== "" &&
    Number.isInteger(seconds) &&
    seconds >= (automation.category === "follow_up" ? 86400 : 0) &&
    seconds <= 2592000;
  return (
    <article className="communications-card">
      <h2>{template?.subject ?? label(automation.template_key)}</h2>
      <p>Default rule: {template?.trigger}</p>
      <div className="communications-actions">
        <label className="communications-checkbox">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Enabled
        </label>
        <label>
          Delay in minutes
          <input
            type="number"
            min={automation.category === "follow_up" ? 1440 : 0}
            max={43200}
            step="1"
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
          />
        </label>
        <Button
          variant="outline"
          disabled={
            busy ||
            !valid ||
            (enabled === automation.enabled &&
              seconds === automation.delay_seconds)
          }
          onClick={() =>
            save({
              template_key: automation.template_key,
              revision: automation.revision,
              enabled,
              delay_seconds: seconds,
            })
          }
        >
          Save timing
        </Button>
      </div>
    </article>
  );
}

function TemplatePreview({
  template,
  token,
  userId,
  testConfigured,
}: {
  template: EmailTemplate;
  token: string;
  userId: string;
  testConfigured: boolean;
}) {
  const [plain, setPlain] = useState(false);
  const request = useRef(crypto.randomUUID());
  const query = useQuery({
    queryKey: ["communications-preview", userId, template.key],
    queryFn: ({ signal }) =>
      communicationsService.operation<EmailPreview>(
        token,
        "preview",
        { template_key: template.key },
        signal,
      ),
    retry: false,
    gcTime: 0,
  });
  const test = useMutation({
    mutationFn: () =>
      communicationsService.operation(token, "test_send", {
        template_key: template.key,
        request_id: request.current,
      }),
  });
  return (
    <article className="communications-card">
      <div className="communications-actions">
        <Button variant="outline" onClick={() => setPlain((value) => !value)}>
          {plain ? "Show HTML" : "Show plain text"}
        </Button>
        <Button
          variant="outline"
          disabled={!testConfigured || test.isPending || test.isSuccess}
          onClick={() => test.mutate()}
        >
          Send preview to myself
        </Button>
      </div>
      {test.isSuccess && (
        <p role="status">Preview accepted by the configured provider.</p>
      )}
      {test.isError && (
        <p role="alert">
          Preview was not confirmed. Check that your staff email is on the
          approved test list, then retry.
        </p>
      )}
      {query.isPending ? (
        <p role="status">Preparing preview…</p>
      ) : query.isError || !query.data ? (
        <p role="alert">Preview unavailable.</p>
      ) : plain ? (
        <pre className="communications-plain">{query.data.text}</pre>
      ) : (
        <iframe
          title={`Email preview: ${template.subject}`}
          sandbox=""
          srcDoc={query.data.html}
          className="communications-email-frame"
        />
      )}
    </article>
  );
}
