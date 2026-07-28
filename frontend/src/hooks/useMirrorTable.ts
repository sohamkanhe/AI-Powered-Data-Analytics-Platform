import { useMutation, useQueryClient } from '@tanstack/react-query';
import { datasetApi } from '../api/client';

export const useMirrorTable = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceId, tableName }: { sourceId: string; tableName: string }) =>
      datasetApi.mirrorTable(sourceId, tableName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['datasets'] });
    },
  });
};