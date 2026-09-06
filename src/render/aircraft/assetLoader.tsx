import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useThree, useLoader } from '@react-three/fiber'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'

const LoaderContext = createContext<KTX2Loader | null>(null)

export function AssetLoaderProvider({ children }: { children: ReactNode }) {
  const gl = useThree((state) => state.gl)
  const [loader] = useState(() => new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}basis/`).setWorkerLimit(2).detectSupport(gl))
  useEffect(() => () => { loader.dispose() }, [loader])
  return <LoaderContext.Provider value={loader}>{children}</LoaderContext.Provider>
}

export function useAircraftAsset(url: string) {
  const ktx2 = useContext(LoaderContext)
  return useLoader(GLTFLoader, url, (loader) => {
    loader.setMeshoptDecoder(MeshoptDecoder)
    if (ktx2) loader.setKTX2Loader(ktx2)
  })
}

export function retryAircraftAsset(url: string) { useLoader.clear(GLTFLoader, url) }
