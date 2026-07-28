import { useQuery } from "@tanstack/react-query";
import { datasetApi } from "../api/client";
import { type Dataset } from "../types";

const useDatasets = ()=>{
    return useQuery<Dataset[]>({
        queryKey: ['datasets'],
        queryFn: async ()=>{
            const {data} = await datasetApi.getDatasets();
            return data;
        },
        refetchInterval: (query) => {
            const hasProcessing = query.state.data?.some((ds:Dataset) => ds.status !== 'completed' && ds.status !== 'failed');
            return hasProcessing ? 3000 : false;
        }
    })
}

export default useDatasets;