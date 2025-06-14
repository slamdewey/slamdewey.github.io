import { finalize, Observable } from 'rxjs';

export class Task {
  public assignee: Unit;
  public isDone: boolean;
  private hasStarted: boolean;
  private observable: Observable<void> | undefined;

  constructor(observable?: Observable<void>) {
    this.observable = observable;
  }

  protected onComplete(): void {}
  protected onResume(): void {}
  protected onCancel(): void {}

  public start(assignee: Unit): void {
    if (this.hasStarted && this.assignee === assignee) {
      this.onResume();
    }
    this.assignee = assignee;
  }

  public update(): void {}

  protected complete(): void {
    this.isDone = true;
    this.onComplete();
  }

  public cancel(): void {
    this.onCancel();
  }
}

export class Unit {
  public hasTasksQueued = () => this.taskQueue.length > 0;
  public isWorking = () => this.currentTask && !this.currentTask?.isDone;

  id: number;
  name: string;
  status: string;

  private taskQueue: Task[];
  private currentTask: Task | undefined;

  private getNextTaskFromQueue(): Task | undefined {
    return this.taskQueue.pop();
  }

  public startTask(task?: Task): void {
    if (this.currentTask && !this.currentTask.isDone) {
      this.currentTask.cancel();
      this.taskQueue = [this.currentTask, ...this.taskQueue];
    }
    this.currentTask = task;
    this.currentTask?.start(this);
  }

  public enqueueTask(task: Task): void {
    this.taskQueue.push(task);
  }

  public update(): void {
    if (!this.isWorking() && this.hasTasksQueued()) {
      this.startTask(this.getNextTaskFromQueue());
    }

    if (this.currentTask && !this.currentTask.isDone) {
      this.currentTask.update();
    }
  }
}
