'use client';

import { Code2, Copy, Download, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Icon } from '@/components/icon';
import { Page, PageHeader, QueryState } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { Card, SectionHeader } from '@/components/ui/card';
import { Checkbox, Field, Input, Select } from '@/components/ui/field';
import { Badge } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { qk, useApiMutation, useTemplates } from '@/lib/queries';

type Channel = {
  channel: number;
  type: string;
  relayPin?: number;
  switchPin?: number;
  switchMode?: 'momentary' | 'latching';
};

// The standard Voltix board: 4 light relays and 2 fan relays, active-LOW.
const voltixBoard: Channel[] = [
  { channel: 1, type: 'switch', relayPin: 25 },
  { channel: 2, type: 'switch', relayPin: 26 },
  { channel: 3, type: 'switch', relayPin: 27 },
  { channel: 4, type: 'switch', relayPin: 14 },
  { channel: 5, type: 'fan', relayPin: 18 },
  { channel: 6, type: 'fan', relayPin: 19 },
];

const pin = (v: string) => (v === '' ? undefined : Math.max(0, Math.min(48, Number(v))));

export default function TemplatesPage() {
  const templates = useTemplates();
  const [channels, setChannels] = useState<Channel[]>(voltixBoard);
  const [code, setCode] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const list = templates.data?.templates ?? [];

  const generate = useApiMutation(() => api.post<{ code: string }>('/templates/firmware', { channels }), {
    onSuccess: (r) => setCode(r.code),
  });
  const remove = useApiMutation((id: string) => api.del(`/templates/${id}`), {
    invalidate: [qk.templates],
    success: 'Template deleted',
  });
  const set = (i: number, patch: Partial<Channel>) =>
    setChannels((all) => all.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <Page>
      <PageHeader title="Device templates" back="/boards" />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <div className="flex items-center gap-3">
            <div className="grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-500">
              <Code2 className="size-6" />
            </div>
            <div>
              <h2 className="font-bold text-xl">Firmware code</h2>
              <p className="text-muted text-sm">
                For boards running your own sketch with the Voltix library.
              </p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {channels.map((c, i) => (
              <div
                key={c.channel}
                className="grid grid-cols-[2.5rem_minmax(0,1fr)_4.5rem_4.5rem_2.5rem] items-end gap-2"
              >
                <span className="grid h-12 place-items-center rounded-xl bg-tint font-bold text-brand-600">
                  {c.channel}
                </span>
                <Field label={i === 0 ? 'Type' : ''}>
                  <Select value={c.type} onChange={(e) => set(i, { type: e.target.value })}>
                    {list.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={i === 0 ? 'Relay' : ''}>
                  <Input
                    type="number"
                    min={0}
                    max={48}
                    placeholder="–"
                    value={c.relayPin ?? ''}
                    onChange={(e) => set(i, { relayPin: pin(e.target.value) })}
                  />
                </Field>
                <Field label={i === 0 ? 'Switch' : ''}>
                  <Input
                    type="number"
                    min={0}
                    max={48}
                    placeholder="–"
                    value={c.switchPin ?? ''}
                    onChange={(e) =>
                      set(i, { switchPin: pin(e.target.value), switchMode: c.switchMode ?? 'latching' })
                    }
                  />
                </Field>
                <button
                  type="button"
                  aria-label={`Remove channel ${c.channel}`}
                  disabled={channels.length === 1}
                  onClick={() => setChannels((all) => all.filter((_, j) => j !== i))}
                  className="grid size-10 place-items-center rounded-full text-muted hover:text-danger disabled:opacity-30"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
          <Checkbox
            className="mt-4"
            label="Wall switches are push buttons (momentary), not rocker switches"
            checked={channels.some((c) => c.switchMode === 'momentary')}
            onChange={(e) =>
              setChannels((all) =>
                all.map((c) => ({
                  ...c,
                  switchMode:
                    c.switchPin !== undefined ? (e.target.checked ? 'momentary' : 'latching') : undefined,
                })),
              )
            }
          />
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              icon={<Plus className="size-4" />}
              disabled={channels.length >= 32}
              onClick={() =>
                setChannels((all) => [
                  ...all,
                  { channel: Math.max(0, ...all.map((c) => c.channel)) + 1, type: 'switch' },
                ])
              }
            >
              Channel
            </Button>
            <Button variant="soft" size="sm" onClick={() => setChannels(voltixBoard)}>
              Reset to Voltix board
            </Button>
            <Button
              size="sm"
              className="ml-auto"
              loading={generate.isPending}
              onClick={() => generate.mutate(undefined)}
            >
              Generate code
            </Button>
          </div>
          {code && (
            <div className="mt-5">
              <div className="mb-2 flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="soft"
                  icon={<Copy className="size-4" />}
                  onClick={() => navigator.clipboard.writeText(code).then(() => toast.success('Copied'))}
                >
                  Copy
                </Button>
                <Button
                  size="sm"
                  variant="soft"
                  icon={<Download className="size-4" />}
                  onClick={() => {
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(new Blob([code], { type: 'text/x-c++src' }));
                    a.download = 'main.cpp';
                    a.click();
                    URL.revokeObjectURL(a.href);
                  }}
                >
                  main.cpp
                </Button>
              </div>
              <pre className="max-h-96 overflow-auto rounded-2xl bg-ink p-4 text-[13px] text-white leading-relaxed">
                <code>{code}</code>
              </pre>
            </div>
          )}
        </Card>

        <section>
          <SectionHeader
            title="Device types"
            action={
              <Button
                size="sm"
                variant="outline"
                icon={<Plus className="size-4" />}
                onClick={() => setCreating(true)}
              >
                Custom type
              </Button>
            }
          />
          <QueryState loading={templates.isPending} error={templates.error}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {list.map((t) => (
                <div key={t.key} className="flex items-center gap-3 rounded-card bg-surface p-4 shadow-card">
                  <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-500">
                    <Icon name={t.icon} className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">
                      {t.name} {!t.builtin && <Badge tone="muted">Custom</Badge>}
                    </p>
                    <p className="truncate text-muted text-xs">{t.capabilities.join(', ')}</p>
                  </div>
                  {!t.builtin && t.id && (
                    <button
                      type="button"
                      aria-label={`Delete ${t.name}`}
                      onClick={() => remove.mutate(t.id!)}
                      className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:text-danger"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </QueryState>
        </section>
      </div>
      {creating && (
        <NewTemplateSheet
          capabilities={templates.data?.capabilities ?? []}
          onClose={() => setCreating(false)}
        />
      )}
    </Page>
  );
}

function NewTemplateSheet({ capabilities, onClose }: { capabilities: string[]; onClose: () => void }) {
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [caps, setCaps] = useState<string[]>(['powerState']);
  const create = useApiMutation(
    () => api.post('/templates', { name: name.trim(), key, capabilities: caps }),
    {
      invalidate: [qk.templates],
      success: 'Template created',
      onSuccess: onClose,
    },
  );
  return (
    <Sheet
      open
      onClose={onClose}
      title="Custom device type"
      footer={
        <Button
          className="w-full"
          size="lg"
          loading={create.isPending}
          disabled={!name.trim() || key.length < 2 || !caps.length}
          onClick={() => create.mutate(undefined)}
        >
          Create
        </Button>
      }
    >
      <div className="space-y-5">
        <Field label="Name">
          <Input
            maxLength={60}
            placeholder="e.g. Water pump"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setKey(
                e.target.value
                  .replace(/[^a-zA-Z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
                  .replace(/^[^a-zA-Z]+/, '')
                  .replace(/^./, (c) => c.toLowerCase())
                  .slice(0, 32),
              );
            }}
          />
        </Field>
        <Field label="Key" hint="Used in firmware: Voltix.addChannel(1, &quot;key&quot;, pin).">
          <Input maxLength={32} value={key} onChange={(e) => setKey(e.target.value)} className="font-mono" />
        </Field>
        <div>
          <span className="mb-2 block font-semibold text-ink-soft text-sm">Capabilities</span>
          <div className="grid grid-cols-2 gap-3">
            {capabilities.map((c) => (
              <Checkbox
                key={c}
                label={c}
                checked={caps.includes(c)}
                onChange={(e) =>
                  setCaps((all) => (e.target.checked ? [...all, c] : all.filter((x) => x !== c)))
                }
              />
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  );
}
