export async function initCamera(videoEl: HTMLVideoElement): Promise<MediaStream> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30 },
      },
      audio: false,
    });

    videoEl.srcObject = stream;
    await videoEl.play();
    return stream;
  } catch (err: any) {
    switch (err.name) {
      case 'NotAllowedError':
        throw new Error('카메라 권한을 허용해주세요');
      case 'NotFoundError':
        throw new Error('카메라 장치를 찾을 수 없습니다');
      case 'NotReadableError':
        throw new Error('카메라가 이미 다른 앱에서 사용 중입니다');
      default:
        throw new Error(`카메라를 시작할 수 없습니다: ${err.message}`);
    }
  }
}
