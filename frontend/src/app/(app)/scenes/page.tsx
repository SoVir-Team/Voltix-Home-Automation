'use client';

import { Pencil, Play, Plus, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { defaultStep, type Step, StepEditor } from '@/components/automation/step-editor';
import { useHome } from '@/components/home-context';
import { Icon, sceneIcons } from '@/components/icon';
import { Page, PageHeader, QueryState } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { IconPicker } from '@/components/ui/icon-picker';
import { EmptyState } from '@/components/ui/misc';
import { ConfirmSheet, Sheet } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { qk, useApiMutation, useDevices, useScenes } from '@/lib/queries';
import type { Device, Scene } from '@/lib/types';

export default function ScenesPage() {
  const { home, canManage } = useHome();
  const scenes = useScenes(home.id);
  const devices = useDevices(home.id);
  const [editing, setEditing] = useState<Scene | 'new' | null>(null);
  const byId = new Map(devices.data?.map((d) => [d.id, d]));

  const run = useApiMutation(
    (s: Scene) => api.post<{ steps: unknown[]; failed: number }>(`/scenes/${s.id}/run`),
    {
      onSuccess: (r, s) => {
        // Partial failures (an offline device) are normal for scenes; say so instead of failing silently.
        if (r.failed) toast.warning(`${s.name}: ${r.failed} of ${r.steps.length} devices didn't respond`);
        else toast.success(`${s.name} is on`);
      },
    },
  );

  return (
    <Page>
      <PageHeader
        title="Scenes"
        back="/"
        actions={
          canManage && (
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              New
            </Button>
          )
        }
      />
      <QueryState loading={scenes.isPending} error={scenes.error}>
        {scenes.data?.length ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
            {scenes.data.map((s) => {
              const running = run.isPending && run.variables?.id === s.id;
              return (
                <Card key={s.id} className="flex flex-col p-4 sm:p-5">
                  <div className="flex items-start justify-between">
                    <div className="grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-500">
                      <Icon name={s.icon ?? 'sparkles'} className="size-6" />
                    </div>
                    {canManage && (
                      <button
                        type="button"
                        aria-label={`Edit ${s.name}`}
                        onClick={() => setEditing(s)}
                        className="grid size-9 place-items-center rounded-full text-muted hover:bg-tint hover:text-brand-600"
                      >
                        <Pencil className="size-4" />
                      </button>
                    )}
                  </div>
                  <p className="mt-3 truncate font-bold">{s.name}</p>
                  <p className="line-clamp-2 min-h-10 text-muted text-sm">
                    {s.actions
                      .slice(0, 3)
                      .map((a) => byId.get(a.deviceId)?.name ?? 'Removed device')
                      .join(', ')}
                    {s.actions.length > 3 && ` +${s.actions.length - 3}`}
                  </p>
                  <Button
                    size="sm"
                    className="mt-4 w-full"
                    icon={<Play className="size-4 fill-current" />}
                    loading={running}
                    onClick={() => run.mutate(s)}
                  >
                    Run
                  </Button>
                </Card>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={<Sparkles className="size-8" />}
            title="No scenes yet"
            action={
              canManage && (
                <Button icon={<Plus className="size-5" />} onClick={() => setEditing('new')}>
                  Create a scene
                </Button>
              )
            }
          >
            A scene sets many devices at once — "Movie night" dims the lights, turns on the TV and closes the
            blinds.
          </EmptyState>
        )}
      </QueryState>
      {editing && (
        <SceneSheet
          key={editing === 'new' ? 'new' : editing.id}
          scene={editing === 'new' ? undefined : editing}
          devices={devices.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
    </Page>
  );
}

function SceneSheet({ scene, devices, onClose }: { scene?: Scene; devices: Device[]; onClose: () => void }) {
  const { home } = useHome();
  const [name, setName] = useState(scene?.name ?? '');
  const [icon, setIcon] = useState(scene?.icon ?? 'sparkles');
  const [steps, setSteps] = useState<Step[]>(
    () => scene?.actions ?? [defaultStep(devices)].filter((s) => s !== null),
  );
  const [confirm, setConfirm] = useState(false);
  const save = useApiMutation(
    () => {
      const body = { name: name.trim(), icon, actions: steps };
      return scene ? api.patch(`/scenes/${scene.id}`, body) : api.post(`/homes/${home.id}/scenes`, body);
    },
    {
      invalidate: [qk.scenes(home.id)],
      success: scene ? 'Scene saved' : 'Scene created',
      onSuccess: onClose,
    },
  );
  const remove = useApiMutation(() => api.del(`/scenes/${scene!.id}`), {
    invalidate: [qk.scenes(home.id)],
    success: 'Scene deleted',
    onSuccess: onClose,
  });

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        title={scene ? 'Edit scene' : 'New scene'}
        wide
        footer={
          <Button
            className="w-full"
            size="lg"
            loading={save.isPending}
            disabled={!name.trim() || !steps.length}
            onClick={() => save.mutate(undefined)}
          >
            Save scene
          </Button>
        }
      >
        <div className="space-y-5">
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Movie night"
              maxLength={60}
            />
          </Field>
          <IconPicker icons={sceneIcons} value={icon} onChange={setIcon} />
          <div>
            <span className="mb-2 block font-semibold text-ink-soft text-sm">When run</span>
            {devices.length ? (
              <div className="space-y-3">
                {steps.map((s, i) => (
                  <StepEditor
                    // biome-ignore lint/suspicious/noArrayIndexKey: steps have no identity besides order
                    key={i}
                    step={s}
                    devices={devices}
                    onChange={(next) => setSteps((all) => all.map((x, j) => (j === i ? next : x)))}
                    onRemove={
                      steps.length > 1 ? () => setSteps((all) => all.filter((_, j) => j !== i)) : undefined
                    }
                  />
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  icon={<Plus className="size-4" />}
                  disabled={steps.length >= 50}
                  onClick={() => {
                    const d = defaultStep(devices);
                    if (d) setSteps((all) => [...all, d]);
                  }}
                >
                  Add device
                </Button>
              </div>
            ) : (
              <p className="text-muted">Add a device first — scenes control your devices.</p>
            )}
          </div>
          {scene && (
            <Button variant="soft" className="w-full text-danger" onClick={() => setConfirm(true)}>
              Delete scene
            </Button>
          )}
        </div>
      </Sheet>
      <ConfirmSheet
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => remove.mutate(undefined)}
        loading={remove.isPending}
        title={`Delete ${scene?.name}?`}
        message="Automations that run this scene will skip it."
      />
    </>
  );
}
