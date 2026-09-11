import { useMutation } from "@tanstack/react-query";
import { ArrowUpRight, Monitor, Smartphone, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  communicationsService,
  type CommunicationsOverview,
  type EmailTemplate,
} from "./service";

const groups = [
  { key: "all", name: "All emails" },
  { key: "customer", name: "Customer journey" },
  { key: "auth", name: "Account access" },
  { key: "security", name: "Account security" },
  { key: "partner", name: "Referral partners" },
] as const;

function groupOf(template: EmailTemplate) {
  return template.identity === "auth" && template.interaction === "notice"
    ? "security"
    : template.identity;
}

/** Scaling the iframe preserves its actual viewport and the email's own responsive rules. */
function EmailCanvas({
  template,
  width,
  thumbnail = false,
}: {
  template: EmailTemplate;
  width: number;
  thumbnail?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(width);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setAvailable(entry.contentRect.width),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const scale = Math.min(1, available / width);
  const height = 1000;
  return (
    <div
      ref={container}
      className={`communications-canvas ${thumbnail ? "communications-thumbnail" : ""}`}
      aria-hidden={thumbnail || undefined}
    >
      <div
        className="communications-canvas-size"
        style={{ width: width * scale, height: height * scale }}
      >
        <iframe
          title={`${thumbnail ? "Thumbnail" : "Email preview"}: ${template.subject}`}
          sandbox=""
          srcDoc={template.preview.html}
          width={width}
          height={height}
          tabIndex={thumbnail ? -1 : 0}
          loading={thumbnail ? "lazy" : "eager"}
          style={{ width, height, transform: `scale(${scale})` }}
        />
      </div>
    </div>
  );
}

export function TemplateGallery({
  data,
  token,
}: {
  data: CommunicationsOverview;
  token: string;
}) {
  const [group, setGroup] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const selected = data.templates.find(
    (template) => template.key === selection,
  );
  const templates = data.templates
    .filter((template) => group === "all" || groupOf(template) === group)
    .filter((template) =>
      `${template.subject} ${template.heading} ${template.trigger}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
    )
    .sort(
      (a, b) =>
        groups.findIndex((g) => g.key === groupOf(a)) -
        groups.findIndex((g) => g.key === groupOf(b)),
    );
  return (
    <Dialog.Root
      open={Boolean(selected)}
      onOpenChange={(open) => {
        if (!open) setSelection(null);
      }}
    >
      <div className="communications-library-heading">
        <div>
          <h2>One design. Every email.</h2>
          <p>
            All {data.templates.length} templates share the Venfour master
            layout.
          </p>
        </div>
        <input
          type="search"
          aria-label="Find an email"
          placeholder="Find an email…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <div className="communications-filters" aria-label="Email categories">
        {groups.map(({ key, name }) => (
          <button
            type="button"
            key={key}
            aria-pressed={group === key}
            onClick={() => setGroup(key)}
          >
            {name}
            <span>
              {
                data.templates.filter(
                  (t) => key === "all" || groupOf(t) === key,
                ).length
              }
            </span>
          </button>
        ))}
      </div>
      <div className="communications-gallery">
        {templates.map((template) => (
          <button
            type="button"
            className="communications-template"
            key={template.key}
            aria-label={`Preview ${template.subject}`}
            onClick={(event) => {
              opener.current = event.currentTarget;
              setSelection(template.key);
            }}
          >
            <EmailCanvas template={template} width={640} thumbnail />
            <span className="communications-template-caption">
              <span className="communications-template-category">
                {groups.find((item) => item.key === groupOf(template))?.name}
                <ArrowUpRight size={16} aria-hidden />
              </span>
              <strong>{template.subject}</strong>
              <span>
                {template.category === "follow_up"
                  ? "Optional reminder"
                  : "Transactional"}
              </span>
            </span>
          </button>
        ))}
      </div>
      {!templates.length && (
        <p role="status">No emails match. Try another search or category.</p>
      )}
      <p className="communications-note">
        Previews use sample links and codes. Designs are published with
        application releases; the active SMTP templates are managed in Supabase
        until the shared Auth hook is enabled there.
      </p>
      {selected && (
        <Dialog.Portal>
          <Dialog.Overlay className="communications-dialog-overlay" />
          <Dialog.Content
            className="communications-dialog"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              opener.current?.focus();
            }}
          >
            <TemplatePreview
              key={selected.key}
              template={selected}
              token={token}
              data={data}
            />
          </Dialog.Content>
        </Dialog.Portal>
      )}
    </Dialog.Root>
  );
}

function TemplatePreview({
  template,
  token,
  data,
}: {
  template: EmailTemplate;
  token: string;
  data: CommunicationsOverview;
}) {
  const [view, setView] = useState<"desktop" | "mobile" | "text">(() =>
    window.matchMedia("(max-width: 760px)").matches ? "mobile" : "desktop",
  );
  const request = useRef(crypto.randomUUID());
  const identity = data.configuration.identities.find(
    (item) => item.name === template.identity,
  );
  const test = useMutation({
    mutationFn: () =>
      communicationsService.operation(token, "test_send", {
        template_key: template.key,
        request_id: request.current,
      }),
  });
  return (
    <>
      <header className="communications-dialog-header">
        <div>
          <Dialog.Title>{template.subject}</Dialog.Title>
          <Dialog.Description>
            Delivery design with sample links and codes. No customer data.
          </Dialog.Description>
        </div>
        <Dialog.Close asChild>
          <button
            type="button"
            aria-label="Close email preview"
            className="communications-close"
          >
            <X size={20} />
          </button>
        </Dialog.Close>
      </header>
      <div className="communications-dialog-body">
        <div className="communications-preview-main">
          <div
            className="communications-device-bar"
            aria-label="Preview format"
          >
            <button
              type="button"
              aria-pressed={view === "desktop"}
              onClick={() => setView("desktop")}
            >
              <Monitor size={16} aria-hidden />
              Desktop
            </button>
            <button
              type="button"
              aria-pressed={view === "mobile"}
              onClick={() => setView("mobile")}
            >
              <Smartphone size={16} aria-hidden />
              Mobile
            </button>
            <button
              type="button"
              aria-pressed={view === "text"}
              onClick={() => setView("text")}
            >
              Plain text
            </button>
            {view !== "text" && (
              <span>{view === "desktop" ? "640" : "375"} px</span>
            )}
          </div>
          {view === "text" ? (
            <pre className="communications-plain">{template.preview.text}</pre>
          ) : (
            <EmailCanvas
              template={template}
              width={view === "desktop" ? 640 : 375}
            />
          )}
        </div>
        <aside className="communications-preview-details">
          <h3>Email details</h3>
          <dl>
            <dt>From</dt>
            <dd>{identity?.from || "Not configured"}</dd>
            <dt>Reply to</dt>
            <dd>{identity?.reply_to || "Not configured"}</dd>
            <dt>Subject</dt>
            <dd>{template.preview.subject}</dd>
            <dt>When it sends</dt>
            <dd>{template.trigger}</dd>
            <dt>Shared design</dt>
            <dd>Venfour master · {template.preview.version}</dd>
          </dl>
          {template.attachment && (
            <p>
              Attachment: {template.attachment}. Test previews contain sample
              email content only.
            </p>
          )}
          {template.identity === "auth" && (
            <p>
              These identities apply to the shared Auth hook. While SMTP is
              active, Supabase controls its sender and published template.
            </p>
          )}
          <div className="communications-test-send">
            <Button
              variant="outline"
              disabled={
                !data.configuration.test_send_configured ||
                test.isPending ||
                test.isSuccess
              }
              onClick={() => test.mutate()}
            >
              Send preview to myself
            </Button>
            <p>Your verified staff email must be on the approved test list.</p>
            {test.isSuccess && (
              <p role="status">Preview accepted by the configured provider.</p>
            )}
            {test.isError && (
              <p role="alert">
                Preview was not confirmed. Check your approved test address,
                then retry.
              </p>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
