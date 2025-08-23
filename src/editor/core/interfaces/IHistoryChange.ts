export interface IHistoryChange {
  type: 'add' | 'update' | 'delete';
  path: string[];
  value?: any;
  previousValue?: any;
}

export interface IHistorySnapshot {
  id: string;
  timestamp: number;
  description: string;
  changes: IHistoryChange[];
  pluginId?: string;
  metadata?: Record<string, any>;
}
