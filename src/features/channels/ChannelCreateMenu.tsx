import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Hash, LockSimple, Plus, ListDashes, SpeakerHigh } from '@phosphor-icons/react'
import type { ChannelType } from '@/types/database.types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FormField } from '@/components/common/FormField'
import { channelService } from '@/services/channel.service'
import type { Channel } from '@/services/channel.service'
import { queryKeys } from '@/lib/query-keys'
import { errorMessage } from '@/lib/errors'
import { useWorkspace } from '@/hooks/use-workspace'
import { usePermission } from '@/hooks/use-permission'
import { cn } from '@/lib/utils'
import { useChannelDirectory } from './use-channels'

/**
 * Creating a channel or a category, from where the channels already are.
 *
 * This used to send people to Settings, which is the wrong place for it: a
 * channel is made in the middle of a conversation about needing one, not
 * during an administration session. Settings keeps the editing.
 *
 * Nothing here decides authorization. Creating a channel needs
 * `channels.create` and creating a category needs `channels.manage`; both are
 * checked again inside the routines, so hiding a menu entry is a courtesy.
 */

/** Sentinel values for the category select — real ids are uuids. */
const NO_CATEGORY = '__none__'
const NEW_CATEGORY = '__new__'

function CreateChannelDialog({
  open,
  onOpenChange,
  organizationId,
  onNavigate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string
  onNavigate?: () => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const directory = useChannelDirectory()
  const canManage = usePermission('channels.manage')

  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState<string>(NO_CATEGORY)
  const [newCategory, setNewCategory] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [type, setType] = useState<ChannelType>('text')

  // Reset on open, so a cancelled attempt never leaks into the next one.
  useEffect(() => {
    if (!open) return
    setName('')
    setCategoryId(NO_CATEGORY)
    setNewCategory('')
    setIsPrivate(false)
    setType('text')
  }, [open])

  const duplicateCategory =
    categoryId === NEW_CATEGORY &&
    newCategory.trim() !== '' &&
    directory.categories.some((c) => c.name.toLowerCase() === newCategory.trim().toLowerCase())

  const create = useMutation({
    mutationFn: async (): Promise<Channel | undefined> => {
      const trimmed = name.trim()
      const wanted = newCategory.trim()

      const id =
        categoryId === NEW_CATEGORY && wanted !== ''
          ? // One transaction: a channel that fails to insert cannot leave the
            // category it would have gone into standing empty behind it.
            await channelService.createChannelInCategory(organizationId, {
              name: trimmed,
              categoryName: wanted,
              isPrivate,
              type,
            })
          : await channelService.createChannel(organizationId, {
              name: trimmed,
              topic: null,
              categoryId:
                categoryId === NO_CATEGORY || categoryId === NEW_CATEGORY ? null : categoryId,
              isPrivate,
              type,
            })

      // The routine returns an id; the address bar needs the slug it made.
      // Invalidating waits for the refetch, so the cache below is the fresh
      // list rather than the one from before the insert.
      await directory.invalidate()
      const channels = queryClient.getQueryData<Channel[]>(queryKeys.channels.all(organizationId))
      return channels?.find((c) => c.id === id)
    },
    onSuccess: (created) => {
      onOpenChange(false)
      // On a phone this dialog sits inside the navigation drawer, and the
      // drawer marks everything behind it as hidden — so it has to be closed
      // before the conversation underneath is reachable at all.
      onNavigate?.()
      toast.success(`Channel ${name.trim()} created.`)
      // Straight into the conversation: creating one is a way of starting it.
      if (created) void navigate(`/channels/${created.key}`)
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

  const blocked = name.trim() === '' || duplicateCategory || create.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showClose={false} aria-describedby={undefined}>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!blocked) create.mutate()
          }}
        >
          <div className="flex gap-3 px-5 pt-5 pb-4">
            <span className="border-primary flex size-8 shrink-0 items-center justify-center rounded-sm border">
              <Hash className="text-primary size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <DialogTitle>Create channel</DialogTitle>
              <DialogDescription className="mt-1">
                Channels are where the organization talks. You can move or rename it later.
              </DialogDescription>
            </div>
          </div>

          <div className="flex flex-col gap-[18px] px-5 pt-1 pb-5">
            <FormField label="Channel name" required>
              {(props) => (
                <Input
                  {...props}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="scrims"
                  maxLength={40}
                  autoFocus
                />
              )}
            </FormField>

            <FormField
              label="Category"
              hint={
                directory.categories.length === 0 && !canManage
                  ? 'No categories yet.'
                  : 'Optional. Leave it uncategorised if it does not belong to a section yet.'
              }
            >
              {(props) => (
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger {...props} aria-label="Category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CATEGORY}>No category</SelectItem>
                    {directory.categories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                    {/* Making a section needs a stronger permission than
                        making a channel, so it is only offered to those who
                        hold it — the routine refuses the rest anyway. */}
                    {canManage ? <SelectItem value={NEW_CATEGORY}>New category…</SelectItem> : null}
                  </SelectContent>
                </Select>
              )}
            </FormField>

            {categoryId === NEW_CATEGORY ? (
              <FormField
                label="New category name"
                required
                error={duplicateCategory ? 'A category with that name already exists.' : undefined}
              >
                {(props) => (
                  <Input
                    {...props}
                    value={newCategory}
                    onChange={(event) => setNewCategory(event.target.value)}
                    placeholder="ESPORTS"
                    maxLength={40}
                  />
                )}
              </FormField>
            ) : null}

            <fieldset className="min-w-0 border-0 p-0">
              <legend className="text-foreground mb-1.5 text-xs font-medium">Kind</legend>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { label: 'Text', value: 'text', icon: Hash },
                    { label: 'Voice', value: 'voice', icon: SpeakerHigh },
                  ] as const
                ).map((option) => {
                  const selected = type === option.value
                  return (
                    <button
                      key={option.label}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setType(option.value)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-sm border px-[11px] py-[5px] text-xs transition-all duration-[140ms]',
                        selected
                          ? 'border-primary bg-primary/14 text-foreground font-medium'
                          : 'border-border text-muted-foreground hover:bg-accent',
                      )}
                    >
                      <option.icon className="size-3.5" aria-hidden="true" />
                      {option.label}
                    </button>
                  )
                })}
              </div>
              <p className="text-muted-foreground text-2xs mt-2 mb-4 leading-relaxed">
                {type === 'voice'
                  ? 'A room to talk in. The same categories and the same permissions as a text channel.'
                  : 'A room for messages, files and threads.'}
              </p>
            </fieldset>

            <fieldset className="min-w-0 border-0 p-0">
              <legend className="text-foreground mb-1.5 text-xs font-medium">Visibility</legend>
              <div className="flex flex-wrap gap-1.5">
                {[
                  {
                    label: 'Public',
                    value: false,
                    icon: Hash,
                    hint: 'Everyone in the organization can see it.',
                  },
                  {
                    label: 'Private',
                    value: true,
                    icon: LockSimple,
                    hint: 'Invisible until a role is explicitly allowed in.',
                  },
                ].map((option) => {
                  const selected = isPrivate === option.value
                  return (
                    <button
                      key={option.label}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setIsPrivate(option.value)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-sm border px-[11px] py-[5px] text-xs transition-all duration-[140ms]',
                        selected
                          ? 'border-primary bg-primary/14 text-foreground font-medium'
                          : 'border-border text-muted-foreground hover:bg-accent',
                      )}
                    >
                      <option.icon className="size-3.5" aria-hidden="true" />
                      {option.label}
                    </button>
                  )
                })}
              </div>
              <p className="text-muted-foreground text-2xs mt-2 leading-relaxed">
                {isPrivate
                  ? 'Invisible until a role is explicitly allowed in, from channel permissions.'
                  : 'Everyone in the organization can see it.'}
              </p>
            </fieldset>
          </div>

          <div className="border-border bg-elevated/40 flex items-center justify-end gap-3 border-t px-5 py-3.5">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending} disabled={blocked}>
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CreateCategoryDialog({
  open,
  onOpenChange,
  organizationId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string
}) {
  const directory = useChannelDirectory()
  const [name, setName] = useState('')

  useEffect(() => {
    if (open) setName('')
  }, [open])

  const duplicate =
    name.trim() !== '' &&
    directory.categories.some((c) => c.name.toLowerCase() === name.trim().toLowerCase())

  const create = useMutation({
    mutationFn: async () => {
      await channelService.createCategory(organizationId, name.trim())
      await directory.invalidate()
    },
    onSuccess: () => {
      onOpenChange(false)
      toast.success(`Category ${name.trim()} created.`)
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

  const blocked = name.trim() === '' || duplicate || create.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showClose={false} aria-describedby={undefined}>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!blocked) create.mutate()
          }}
        >
          <div className="flex gap-3 px-5 pt-5 pb-4">
            <span className="border-primary flex size-8 shrink-0 items-center justify-center rounded-sm border">
              <ListDashes className="text-primary size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <DialogTitle>Create category</DialogTitle>
              <DialogDescription className="mt-1">
                A section to group channels under. It starts empty.
              </DialogDescription>
            </div>
          </div>

          <div className="px-5 pt-1 pb-5">
            <FormField
              label="Category name"
              required
              error={duplicate ? 'A category with that name already exists.' : undefined}
            >
              {(props) => (
                <Input
                  {...props}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="ESPORTS"
                  maxLength={40}
                  autoFocus
                />
              )}
            </FormField>
          </div>

          <div className="border-border bg-elevated/40 flex items-center justify-end gap-3 border-t px-5 py-3.5">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending} disabled={blocked}>
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The `+` beside the CHANNELS heading, and everything it opens. */
export function ChannelCreateMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { organization } = useWorkspace()
  const canCreate = usePermission('channels.create')
  const canManage = usePermission('channels.manage')
  const [dialog, setDialog] = useState<'channel' | 'category' | null>(null)

  const organizationId = organization?.id
  if (!organizationId || (!canCreate && !canManage)) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground size-5"
            aria-label="Create channel or category"
          >
            <Plus className="size-3.5" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          {canCreate ? (
            <DropdownMenuItem onSelect={() => setDialog('channel')}>
              <Hash className="size-3.5" aria-hidden="true" />
              Create channel
            </DropdownMenuItem>
          ) : null}
          {canManage ? (
            <DropdownMenuItem onSelect={() => setDialog('category')}>
              <ListDashes className="size-3.5" aria-hidden="true" />
              Create category
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {canCreate ? (
        <CreateChannelDialog
          open={dialog === 'channel'}
          onOpenChange={(open) => setDialog(open ? 'channel' : null)}
          organizationId={organizationId}
          onNavigate={onNavigate}
        />
      ) : null}
      {canManage ? (
        <CreateCategoryDialog
          open={dialog === 'category'}
          onOpenChange={(open) => setDialog(open ? 'category' : null)}
          organizationId={organizationId}
        />
      ) : null}
    </>
  )
}
