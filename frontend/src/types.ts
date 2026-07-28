export interface Dataset {
  id: string;
  display_name: string;
  source_type: string;
  source_id?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  row_count?: number;
}