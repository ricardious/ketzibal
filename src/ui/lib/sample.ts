/** Rasteriza el símbolo de Ketzvia a PNG para probar el flujo completo sin un archivo propio. */
export async function sampleFile(): Promise<File> {
  const url = `${import.meta.env.BASE_URL}ketzvia-simbolo.svg`;
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  c.getContext('2d')!.drawImage(img, 0, 0, 512, 512);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo generar la imagen'))), 'image/png'));
  return new File([blob], 'ketzvia-simbolo.png', { type: 'image/png' });
}

export function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
