import { useMutation, useQueryClient } from "@tanstack/react-query";
import { datasetApi } from "../api/client";

const useUploadDataset = ()=>{
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (file: File)=>{
            const formData = new FormData();
            formData.append('file', file);
            return datasetApi.uploadFile(formData);
        },
        onSuccess : ()=>{
            queryClient.invalidateQueries({queryKey:['datasets']})
        }
    })
}

export default useUploadDataset;