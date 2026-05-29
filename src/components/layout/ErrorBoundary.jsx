import React from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Caught render error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[300px] p-8 gap-4">
          <AlertTriangle className="w-10 h-10 text-destructive" />
          <div className="text-center">
            <p className="font-semibold text-lg">Something went wrong</p>
            <p className="text-sm text-muted-foreground mt-1">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            {this.state.error?.stack && (
              <p className="text-[10px] text-muted-foreground/60 mt-2 font-mono max-w-lg text-left break-all">
                {this.state.error.stack.split('\n').slice(0, 4).join('\n')}
              </p>
            )}
          </div>
          <Button
            variant="outline"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              if (this.props.onReset) this.props.onReset();
            }}
            className="gap-2"
          >
            <RefreshCw className="w-4 h-4" /> Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
