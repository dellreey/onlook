/**
 * O provider de sistema de arquivos, num ponto de entrada só do servidor.
 *
 * Ele lê e escreve arquivos de verdade, então importa `node:fs/promises`. O índice do pacote é
 * carregado também pelo browser — o `SessionManager` do editor importa `@onlook/code-provider` para
 * escolher o provider pelo nome — e um módulo de Node alcançável a partir dali quebra o bundle do
 * cliente: `node:fs/promises` é um módulo externo, e o chunk do browser não sabe resolvê-lo.
 *
 * Por isso o NodeFs mora aqui, atrás de `@onlook/code-provider/nodefs`, e nunca é reexportado pelo
 * índice. Quem cria é o runtime local do servidor, que é o único lugar onde existe um caminho no disco.
 */
import { CodeProvider } from './providers';
import { NodeFsProvider, type NodeFsProviderOptions } from './providers/nodefs';

export { NodeFsProvider } from './providers/nodefs';
export type { NodeFsProviderOptions } from './providers/nodefs';

/** Cria o provider já inicializado para uma raiz de projeto autorizada pelo servidor. */
export async function createNodeFsProvider(options: NodeFsProviderOptions): Promise<NodeFsProvider> {
    const provider = new NodeFsProvider(options);
    await provider.initialize({});
    return provider;
}

/** O nome do provider, para quem só precisa dizer de qual modo se está falando. */
export const NODE_FS_PROVIDER = CodeProvider.NodeFs;
