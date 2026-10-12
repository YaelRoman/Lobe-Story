import { Component, createRef, type ErrorInfo, type ReactNode } from 'react';
import { useStore } from '../state/store';
import { serializeProject } from '../state/project';
import { downloadText } from './download';

/** Whether the keyboard focus is nowhere: what a focused element leaves behind when it is taken off the page. */
const focusIsLost = (): boolean => document.activeElement === null || document.activeElement === document.body;

const messageOf = (error: unknown): string => (error instanceof Error && error.message ? error.message : String(error));

interface Caught {
  /** The message of the error that was caught (null: none, the children are shown). */
  error: string | null;
}

interface PlotBoundaryProps {
  /** Class of the box shown instead of the plot (the plot's own, so the page keeps its layout). */
  className?: string;
  /** Called when an error was caught (the plot will not report that it was drawn). */
  onError?: () => void;
  /**
   * What the plot is made from (its figure, the plot type…). When one of them is another object or value than at the
   * time of the error, the message goes away and the plot is tried again: unticking the offending file or changing
   * the plot type is enough, "Try again" is not needed.
   */
  resetKeys?: readonly unknown[];
  children?: ReactNode;
}

const sameKeys = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean =>
  a === b || (a !== undefined && b !== undefined && a.length === b.length && a.every((v, i) => Object.is(v, b[i])));

/**
 * Keeps an error thrown while a plot is built or drawn inside that plot's region: the toolbar, the file panel and
 * the table stay. "Try again" mounts the plot anew, and so does a change of the `resetKeys`.
 */
interface PlotCaught extends Caught {
  /** The reset keys the plot failed with (`recorded`: they have been noted since the error). */
  failedWith: readonly unknown[] | undefined;
  recorded: boolean;
}

export class PlotBoundary extends Component<PlotBoundaryProps, PlotCaught> {
  state: PlotCaught = { error: null, failedWith: undefined, recorded: false };

  static getDerivedStateFromError(error: unknown): Partial<PlotCaught> {
    return { error: messageOf(error), recorded: false };
  }

  // Only keys other than the ones the plot failed with are worth another try: the same ones would fail the same way, forever.
  static getDerivedStateFromProps(props: PlotBoundaryProps, state: PlotCaught): Partial<PlotCaught> | null {
    if (state.error === null) return null;
    if (!state.recorded) return { failedWith: props.resetKeys, recorded: true };
    return sameKeys(state.failedWith, props.resetKeys) ? null : { error: null, recorded: false };
  }

  private heading = createRef<HTMLParagraphElement>();

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('A plot could not be drawn', error, info.componentStack);
    this.props.onError?.();
  }

  componentDidMount(): void {
    this.focusHeading();
  }

  componentDidUpdate(_: PlotBoundaryProps, before: PlotCaught): void {
    if (before.error === null) this.focusHeading();
  }

  /**
   * When the message has just appeared and the focus was inside the plot (it is nowhere now), the heading takes it,
   * so the keyboard and a screen reader continue from the message. A focus elsewhere (the control that was being
   * used) is left alone: the message is an alert and is announced anyway.
   */
  private focusHeading(): void {
    if (this.state.error !== null && focusIsLost()) this.heading.current?.focus();
  }

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <div className={`plot-failed${this.props.className ? ` ${this.props.className}` : ''}`} role="alert">
        <p tabIndex={-1} ref={this.heading}>
          <strong>This plot could not be drawn</strong>
        </p>
        <p className="plot-failed-detail">{error}</p>
        <button type="button" onClick={() => this.setState({ error: null, recorded: false })}>
          Try again
        </button>
      </div>
    );
  }
}

interface AppBoundaryProps {
  children?: ReactNode;
  /** Reloads the page (replaced in tests). */
  reload?: () => void;
}

interface AppCaught extends Caught {
  /** Result of "Save project" (null: not pressed). */
  saved: 'yes' | 'failed' | null;
}

/**
 * The last resort around the whole app: an error nothing else caught leaves a minimal screen instead of a blank
 * page. The session is still in the store, so it can be saved as a project (files included) before reloading.
 */
export class AppBoundary extends Component<AppBoundaryProps, AppCaught> {
  state: AppCaught = { error: null, saved: null };

  static getDerivedStateFromError(error: unknown): Partial<AppCaught> {
    return { error: messageOf(error) };
  }

  private heading = createRef<HTMLHeadingElement>();

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('The app stopped on an error', error, info.componentStack);
  }

  componentDidMount(): void {
    if (this.state.error !== null) this.heading.current?.focus();
  }

  // The whole page was replaced, whatever had the focus with it: the heading takes it.
  componentDidUpdate(_: AppBoundaryProps, before: AppCaught): void {
    if (before.error === null && this.state.error !== null) this.heading.current?.focus();
  }

  private save = (): void => {
    try {
      const date = new Date().toISOString().slice(0, 10);
      downloadText(`lobe-story-${date}.lobestory.json`, serializeProject(useStore.getState(), true), 'application/json');
      useStore.getState().markSaved();
      this.setState({ saved: 'yes' });
    } catch {
      this.setState({ saved: 'failed' });
    }
  };

  render(): ReactNode {
    const { error, saved } = this.state;
    if (error === null) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h1 tabIndex={-1} ref={this.heading}>
          Lobe-Story
        </h1>
        <p>
          <strong>Something went wrong and the page cannot be shown.</strong> Your session is still in memory: save it as a
          project, then reload and open the project again.
        </p>
        <p className="plot-failed-detail">{error}</p>
        <div className="crash-actions">
          <button type="button" onClick={this.save}>
            Save project
          </button>
          <button type="button" onClick={this.props.reload ?? (() => window.location.reload())}>
            Reload
          </button>
        </div>
        <p role="status">{saved === 'yes' ? 'Project saved (pattern files included).' : saved === 'failed' ? 'Could not save the project.' : ''}</p>
      </div>
    );
  }
}
