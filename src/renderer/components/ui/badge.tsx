import React from 'react'
import { cn } from '@/lib/utils'

type Props = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: 'default' | 'secondary' | 'outline'
}

export const Badge: React.FC<Props> = ({ className, variant = 'secondary', ...props }) => {
  const base = 'inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs'
  const styles =
    variant === 'outline'
      ? 'border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300'
      : variant === 'default'
      ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
      : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border border-gray-300 dark:border-gray-700'
  return <span className={cn(base, styles, className)} {...props} />
}

export default Badge

