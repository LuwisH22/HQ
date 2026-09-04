import { Link } from 'react-router-dom'
import { Compass } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/common/states'

export function NotFoundPage() {
  return (
    <div className="mx-auto w-full max-w-md p-6">
      <EmptyState
        icon={Compass}
        title="This page does not exist"
        description="The link may be out of date, or the section may have moved."
        action={
          <Button size="sm" asChild>
            <Link to="/">Back to the dashboard</Link>
          </Button>
        }
      />
    </div>
  )
}
