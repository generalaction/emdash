import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { FolderOpen } from 'lucide-react';

type Props = {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
};

const SidebarEmptyState: React.FC<Props> = ({ title, description, actionLabel, onAction }) => {
  return (
    <div>
      <Card className="bg-muted/20">
        <CardHeader className="py-3 sm:py-4">
          <CardTitle className="text-base leading-tight">{title}</CardTitle>
          {description ? (
            <CardDescription className="text-xs leading-relaxed">{description}</CardDescription>
          ) : null}
        </CardHeader>
        {actionLabel && onAction ? (
          <CardContent className="pt-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full justify-center"
              onClick={onAction}
            >
              <FolderOpen className="mr-2 h-4 w-4" />
              {actionLabel}
            </Button>
          </CardContent>
        ) : null}
      </Card>
    </div>
  );
};

export default SidebarEmptyState;
