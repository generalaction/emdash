import React from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Spinner } from './ui/spinner';
import { GitBranch, Bot, Play, Pause, Plus } from 'lucide-react';

interface Task {
  id: string;
  name: string;
  branch: string;
  path: string;
  status: 'active' | 'idle' | 'running';
}

interface Props {
  tasks: Task[];
  activeTask: Task | null;
  onSelectTask: (task: Task) => void;
  onCreateTask: () => void;
}

export const TaskList: React.FC<Props> = ({ tasks, activeTask, onSelectTask, onCreateTask }) => {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <Play className="h-4 w-4 text-green-500" />;
      case 'idle':
        return <Pause className="h-4 w-4 text-yellow-500" />;
      default:
        return <Bot className="h-4 w-4 text-blue-500" />;
    }
  };

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold">Tasks</h2>
        <Button variant="default" size="sm" onClick={onCreateTask}>
          <Plus className="mr-2 h-4 w-4" /> New
        </Button>
      </div>

      {tasks.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
          <Bot className="mb-4 h-12 w-12" />
          <p className="text-center">No tasks yet. Create one to get started!</p>
        </div>
      ) : (
        <div className="flex-1 space-y-3 overflow-y-auto">
          {tasks.map((task) => (
            <Card
              key={task.id}
              className={`cursor-pointer transition-all duration-200 ${
                activeTask?.id === task.id
                  ? 'border-blue-500 ring-2 ring-blue-500'
                  : 'border-border hover:border-border dark:border-border dark:hover:border-border'
              }`}
              onClick={() => onSelectTask(task)}
            >
              <CardHeader className="p-4">
                <CardTitle className="flex items-center text-lg">
                  {getStatusIcon(task.status)}
                  <span className="ml-2">{task.name}</span>
                </CardTitle>
                <CardDescription className="mt-1 flex items-center text-sm text-muted-foreground">
                  <GitBranch className="mr-1 h-3 w-3" />
                  <code className="font-mono text-xs">{task.branch}</code>
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-0 text-xs text-muted-foreground">
                <p className="capitalize">Status: {task.status}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default TaskList;
