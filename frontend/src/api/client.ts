import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:8000/api',
});

export const datasetApi = {
  getDatasets: () => api.get('/dataset/'), 
  
  uploadFile: (formData: FormData) => api.post('/ingest/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),

  getPreview: (id: string) => api.get(`/dataset/${id}/preview`),

  connectDb: (payload: { name: string; connection_url: string }) => 
    api.post('/ingest/connect-db', payload),

  getTables: (sourceId: string) => api.get(`/ingest/connect-db/${sourceId}/tables`),
    
  mirrorTable: (sourceId: string, tableName: string) => 
    api.post(`/ingest/mirror-table?source_id=${sourceId}&table_name=${tableName}`),
};

export default api;