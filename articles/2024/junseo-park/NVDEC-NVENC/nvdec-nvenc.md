# NVIDIA Video Codec SDK로 PyTorch에서 비디오 처리 가속화하기

비디오 트랜스코딩에 짤막한 설명 포함

![테스트 비디오](assets/test_video.png)

최근에 진행한 작업으로 학습에 필요한 비디오 데이터를 전처리하는 프로세스를 가속화하는 작업을 진행했습니다. 주로 모델을 최적화하는 일을 하다가 전체 프로세스를 건드는 일을 하니까 꽤 진이 빠지네요. 비디오 데이터 전처리는 꽤나 비용이 많이 드는 작업입니다.

왜냐하면 동영상을 디코딩해서 Tensor로 추출하고, 추출한 Tensor를 GPU에 보내고, 모델에 넣고 다시 인코딩을 하거나 정보를 뽑거나 하는 일을 해야하거든요. 1분 영상만 디코딩해도 1초에 25프레임 영상이라고 하면 1500장의 이미지를 작업을 해야합니다. 이걸 빠르게 하기 위해 사소한 것 조차 무시할 수가 없더군요. 하나가 잘못 사소하기만 해도 기하급수적으로 프로세스가 느려지는 경험을 많이 한 것 같습니다.

정리도 못할 수준으로 중구난방하게 작업을 해서 정리가 좀 많이 필요하지만, 성능 향상에 대한 주요 Features들은 어느 정도 추출이 되서 거기서 가장 임팩트가 컸던 걸 글로 정리해보려 합니다.

많고 많은 Features 중에 가장 성능을 크게 개선한 것이 하드웨어 트랜스코딩이였습니다. 그래서 이런 주제를 가져와 봤구요, 다음 편에서는 그 다음으로 성능을 크게 개선한 Features를 가져올 것 같네요.

우선 이 글을 보기 전에 비디오 트랜스코딩에 대한 간단한 지식이 있으면 조금 더 잘 읽히지 않을까? 해서 간략하게 비디오 트랜스코딩과 하드웨어 가속에 대해 잠깐 설명하고 넘어가겠습니다.

## 개요

![다음팟인코더](assets/pod_encoder.png)

컴퓨터를 다루는 사람이라면 비디오 인코딩이라는 걸 해보신적이 몇 번 있을 것 같습니다. 흔히 옛날에 전자사전에 인강을 넣거나, 옛날 스마트폰에 영화를 넣거나, 심지어는 PSP에 동영상을 넣거나 이런 적이 종종 있었기도 했죠. 그런 기기에 영상을 넣을때 그냥 넣으면 "지원하지 않는 코덱입니다." 이런 오류를 자주 보았던 기억이 나네요.

그래서 곰인코더나 기타 인코딩 프로그램을 설치해서 각 기기에 맞는 코덱을 찾아서 넣고 나서야 영상이 재생되곤 했었습니다. 도대체 왜 이런 번거롭고 귀찮은 과정을 거쳐야 하는 걸까요? 다 이유가 있습니다.

## 인코딩과 디코딩 그리고 트랜스코딩

일단 비디오의 개념부터 알아야합니다. 비디오는 일종의 연속된 이미지를 포함하고 있고 추가적으로 음성이 포함되어 있기도 합니다. 하지만 말 그대로 연속된 이미지를 나열하기만 하면 다음과 같은 현상이 일어납니다.

![용량 정상화](assets/god.gif)

왼쪽은 200x200 해상도를 가지는 GIF 이미지이고 총 83프레임을 가지고 있습니다. 그리고 1초에 25프레임을 재생합니다. 오른쪽은 mp4이며 mp4 비디오이며 스펙은 GIF와 완전히 동일합니다. 그런데 용량이 무려 6배나 차이나는 걸 확인 할 수 있죠.

왜 이렇게 용량 차이가 큰 걸까요? **GIF는 연속된 프레임에 대한 압축을 할 수 없습니다.** 단순히 83장의 이미지가 하나의 GIF 파일에 그대로 담겨있는 셈이죠. 반면 MP4와 같은 비디오 형식은 연속된 프레임 간의 압축이 가능합니다. 영상의 움직임이 더 적을수록 압축 효과는 더욱 커집니다. 이처럼 비디오는 연속된 프레임에 대한 효율적인 압축 기술을 사용하며, 이 압축을 하는 것이 **인코딩**이라고 부릅니다.

인코딩(압축)된 비디오를 재생하려면 반드시 압축을 해제해야 합니다. 압축된 zip 파일을 쓸려면 압축을 해제해야죠? 이렇게 비디오를 압축 해제하는 과정을 **디코딩**이라고 부릅니다. 압축을 해제해서 연속된 이미지로 보게 되는 것이죠. 우리가 비디오 플레이어를 통해 비디오를 볼 때, 실제로는 비디오 디코딩 과정이 계속 진행되고 있는 것입니다. 즉, 비디오를 직접 보기 위해서는 반드시 디코딩 과정이 필요합니다.

이때 중요한 점은 압축할 때 사용한 알고리즘과 압축 해제 시 사용하는 알고리즘이 동일해야 한다는 것입니다. 이것이 바로 과거의 기기들이 지원하는 코덱이 제한적이었던 이유입니다. 인코딩과 디코딩 과정은 코덱에 따라서 상이한 연산 능력을 필요로 하기 때문에, 옛날 기기의 하드웨어 성능에 맞는 코덱으로 변환해야 했던 것입니다.

예를 들어서 전자 사전에 mp4(H.264)로 된 인강을 한 10개 정도 넣는다고 생각해봅시다.

![이세계닌텐도](assets/nurian_x9.png)

해당 전자사전은 2008년 즈음에 나온 누리안 x9이라고 하며 WMV1(WMV7) 코덱으로만 영상 재생이 가능하다고 합니다. 그러면 H.264 디코딩 -> WMV1 인코딩 을 거쳐야겠네요. 이렇게 영상의 코덱을 바꾸는 것이 **트랜스코딩**이라고 합니다.

영상들을 트랜스코딩 할 때 항상 속도가 좀 느렸곤 했었죠. 옛날에는 조금만 인코딩을 해도 예상 시간은 30분 넘기는건 기본이니 말입니다. 그래서 이걸 빠르게 못하나하고 조사를 해보면 항상 나왔던 게 **하드웨어 가속** 이였습니다. 그래서 인코딩 프로그램에서 하드웨어 가속을 키면 기존에 비해 빠르게 프로그래스 바가 채워지곤 했었죠.

그럼 어째서 하드웨어 가속이 더 빠를까요? 또 알아봅시다.

## 하드웨어 가속

하드웨어 가속이란 비디오 뿐만 아니라 다른 곳에서도 많이 사용되는 개념입니다. 아마 제일 많이 사용되는 곳은 지금 현재 보고 계시는 인터넷 브라우저일 겁니다.

![하드웨어 렌더링](assets/chrome-hw-accel.png)

하드웨어 가속은 흔히 CPU에서 할 일을 GPU나 FPGA와 같은 외부 장치에서 하여 이기종 컴퓨팅을 활용하는 개념입니다. GPU와 CPU는 동시에 작업을 할 수 있고, GPU는 렌더링 능력이 매우 뛰어나므로 브라우저에서 렌더링하는 걸 GPU에서 하는 것이죠.

![GPU Render](assets/gpu_usage.png)

위 사진처럼 브라우저에 GPU를 사용하고 있는걸 볼 수 있죠. Notion이랑 VSCode도 보이네요 ㅋㅋ. 역시 비디오에서도 이 GPU를 통해 하드웨어 가속을 실현 할 수 있습니다. 다만 렌더링 기술과는 좀 더 다르게 GPU에는 별도의 디코딩, 인코딩 칩이 내장되어 있고, 그 칩으로 하드웨어 가속을 실현하게 되는 것이죠.

GPU 뿐만 아니라 FPGA에도 디코딩, 인코딩 칩을 구현한 사례도 있습니다. Xilinx가 그 분야에서는 대표적이죠. 또 Mac에는 ProRes 코덱을 디코딩 인코딩하는 하드웨어 가속기도 포함되어 있죠.

설명한 것 보다 디코딩, 인코딩을 위한 칩이 내제되어 있는 디바이스는 더 많지만, 이번에는 주제가 주제인 만큼 제가 직접적으로 이득을 본 NVIDIA의 NVDEC, NVENC를 설명하고자 합니다. 자세한 하드웨어 디코딩, 인코딩 알고리즘은 설명은 따로 하지 않겠습니다. (사실 못하는게 맞습니다. 너무 어렵더라구요.)

## NVIDIA NVDEC, NVENC

![NVIDIA Video Codec SDK](assets/arch.png)

GPU를 이용한 비디오 트랜스코딩은 꽤나 역사가 많이 깁니다. 윈도우 95가 출시 되고 나서 가정에 PC가 보급됐던 시절 비디오 미디어의 인기가 매우 치솟았고 시간이 지나면서 HD 동영상에 대한 수요가 나왔었는데, 그 때 당시에는 CPU가 싱글 코어가 전부여서 HD 영상을 부드럽게 재생시키기 힘들었습니다. 마치 지금 시대의 8K 재생을 힘들어 하는 것 같이요.

그래서 이를 커버할 부가적인 하드웨어가 필요했었고, 많은 하드웨어를 찾은 끝에 GPU가 적합하다고 지목되었습니다. 그 다음 부터 GPU 회사들은 열심히 동영상 가속을 위한 개발을 시작했습니다. 그 때 나온 것이 2004년에 나온 NVIDIA PureVideo 이였죠. 해당 기술은 전용 동영상 하드웨어 칩을 사용하여 동영상 트랜스코딩을 가속화를 이루어냈습니다. 그 후로 부터 점차 발전되어 HD, FHD, 4K 비디오는 GPU를 통해 매끄럽게 재생이 되었으며, 더 발전되어 오늘날의 NVIDIA Video Codec SDK 까지 발전되어 왔습니다.

현재 최신 NVIDIA GPU에도 이 전용 하드웨어 칩이 v10까지 업그레이드 되어 내장되어 있고, 그 칩의 이름은 디코딩을 담당하는 NVDEC, 인코딩은 NVENC라는 이름으로 내재되어 있습니다.

NVDEC와 NVENC를 사용하는 방법은 정말 간단합니다. FFmpeg에서 이 NVDEC, NVENC를 정말 쉽게 사용할수 있게 만들어 놔서, 그냥 GPU가 있는 환경에 apt install ffmpeg 만 해도 GPU 트랜스코딩을 사용할 수 있습니다.

```bash
ffmpeg -hwaccel cuda -i input.mp4 -c:v h264_nvenc output.mp4
```

-hwaccel cuda 이 NVDEC를 사용하는 것이고 h264_nvenc 는 h264를 NVENC로 인코딩하겠다는 명령어입니다. 참 간단하죠?

FFmpeg에서도 간단하게 사용할 수 있지만, C나 C++에서는 SDK를 사용해서 개발할 수 있습니다.

요즘에는 딥러닝 때문에 Python 유저가 많아서 그런지, 최근에 PyNvVideoCodec 라는 라이브러리를 만들어 직접 C++ SDK에 접근할 수 있게 되었습니다. 이건 따로 테스트를 해보진 않았는데 한번 테스트 해봐야겠네요.

## FFmpeg에서 프레임을 코드로 가져오다.

ffmpeg은 Python, C, C++에서 subprocess를 통해 실행시켜, 디코딩 한 frame을 직접 코드에 가져올 수 있습니다.  ffmpeg decode만 subprocess로 돌려서 stdout을 가져와 np.frombuffer에 넣어서 numpy array로 가져올 수 있었죠.

![FFmpeg Numpy](assets/ffmpeg_numpy.png)

이 코드는 약 3년 전에 Video Super Resolution 프로젝트를 하면서 사용해본 적이 있었습니다. numpy array로 가져와서 GPU로 데이터로 옮기는 일련의 과정은 조금 느렸지만, 모델이 훨씬(x10) 느렸기 때문에 크게 문제되는 이슈는 아니였던 기억이 있습니다.

다만 여기서 제가 궁금했던 것은 ffmpeg에서 이미 하드웨어 디코딩을 하고 있는데, 그러면 Output Frame은 GPU Tensor일 텐데 이걸 바로 가져올 순 없나? 하는 잠깐의 의문이 있었습니다. 왜냐하면 Buffer -> GPU (NVDEC) -> CPU (Numpy) -> GPU (PyTorch)를 거치는 걸 Buffer -> GPU (NVDEC) -> GPU (PyTorch) 로 바꿔서 훨씬 효율적인 데이터 전송을 할 수 있으니까요. 하지만 해당 프로젝트에서는 이 부분에서는 크게 문제되지 않는 상황이라 덮어놨었습니다.

이게 왜 중요한 사항인지는 옛날에 [이 글](https://medium.com/monday-9-pm/triton-inference-server%EC%9D%98-%EB%AA%A8%EB%8D%B8-%ED%8C%8C%EC%9D%B4%ED%94%84%EB%9D%BC%EC%9D%B8-%EC%98%A4%EB%B2%84%ED%97%A4%EB%93%9C-%EC%A4%84%EC%9D%B4%EA%B8%B0-5ecd84216956)에서 알 수 있을겁니다.

그런데 이번에 새로 이직하게 된 곳에서 전담으로 맡은 작업 중에, 비디오 전처리 가속화 작업이 있었습니다. 해당 전처리 파이프라인은 모델은 이미 너무 빠른 상황이였고, 단지 비디오의 디코딩 과정이 OpenCV로 되어 있었고, 이전에 했던 Video Super Resolution 프로젝트에서 생긴 이슈가 여기서 발생하고 있어 GPU의 Utils이 0~10%로 놀고 있는 상황이였습니다. 즉 프레임을 모델에 빠르게 못 넣고 있어서 GPU가 놀고 있던 것이였죠.

이 기점에서 제가 덮어놨던 걸 다시 조사를 했고, 역시나 저와 비슷한 생각을 하는 사람이 많았으며 실제로 해결책이 있었습니다. 저희 회사에서도 많이 사용되는 라이브러리에 있었고, 그것은 바로 torchaudio 라이브러리 였습니다.

## NVDEC CUDA Frame을 PyTorch Tensor로 가지고 오다.

![torchaudio nvdec](assets/torchaudio_nvdec.png)

[해당 페이지](https://pytorch.org/audio/stable/tutorials/nvdec_tutorial.html)에는 torchaudio로 NVDEC를 이용해서 비디오를 디코딩하는 튜토리얼이 있습니다.

해당 라이브러리는 제가 옛날에 했던 subprocess 방식이 아닌 FFmpeg의 C API를 그대로 가져와서 개발되었기 때문에, 훨씬 더 안정적이고 빠르게 작동합니다. 해당 튜토리얼을 하기 위해서 FFmpeg이 설치되어 있어야합니다. 사실상 위에 있는 간단한 FFmpeg GPU 트랜스코딩이 돌아간다면 곧바로 사용할 수 있습니다.

![so easy](assets/simple_gpu_tensor.png)

그 다음 위의 단 4줄이면 5 Frame의 GPU Tensor를 가져올 수 있습니다. 참 쉽죠? decoder에는 h264_cuvid로 NVDEC를 이용한 h264 코덱 디코딩을 활성화 하고, hw_accel 옵션으로 디코딩된 프레임을 CUDA Tensor로 옮깁니다. 물론 실제로 사용할때는 이렇게 사용하는 것보다, 조금 더 상위 API를 사용하는게 좋습니다. 저걸 계속 반복해서 재생시키면 EOF 에러가 나서 상위 API는 이에 대한 EOF 처리가 되있기 때문입니다.

![generator stream](assets/generator_stream.png)

위 코드 처럼 s 객체를 가져와 s.stream()으로 반복문을 돌리면 EOF를 만나면 알아서 탈출되는 API도 제공됩니다. 이를 통해 안전하게 디코딩을 할 수 있죠. 그럼 한번 성능을 봐볼까요?

![Bench](assets/benchmark.png)

torchaudio에는 CPU로도 디코딩을 할 수 있고, 위 그래프는 CPU로 디코딩하고 torch.cuda()로 GPU Tensor로 옮긴 작업이고, 하드웨어 디코딩은 그냥 하드웨어 디코딩하고 바로 GPU Tensor로 가져온 벤치마크입니다.

작은 해상도에서는 하드웨어 디코딩이 더 느리지만 640x480 만 가도 약 1.8배 더 빠르고, 1024x768에서는 2배 더 빠릅니다. 그리고  요즘은 비디오 해상도가 1280x720, 1920x1080, 3840x2160이 거의 기본이기 때문에 해상도가 커지면 커질수록 그 격차는 더 벌어지죠. 실제로 여기에는 포함되어 있지 않지만 1920x1080을 디코딩 하는데 OpenCV로 디코딩한 것은 초당 200 frames, NVDEC는 초당 800 frames을 연산해서 약 4배 더 빠른 디코딩을 구현할 수 있었습니다.

아직 더 놀라운 점은 하드웨어 디코딩은 H264보다 그 상위 코덱이 더 빠르다는 겁니다.

![H264 is Trash](assets/h264_is_trash.png)

위는 NVIDIA에서 제공한 Decode benchmark인데, L4 기준으로 HEVC가 H264보다 두배 더 빠르다는 겁니다. 실제로 L4 GPU로 HEVC를 디코딩하니 기존 초당 800 frames에서 초당 1800 frames까지 가속이 되었습니다. OpenCV로 디코딩은 따로 안해봤지만 HEVC는 알고리즘이 H264보다 더 복잡해서 CPU로 처리할 때는 더 느리겠죠.

## 한계와 해결해야 할 점

![힝](assets/weak_doge.png)

여태까지 보면 장점밖에 없어 보이는데, 정말 큰 문제가 있습니다. 그건 바로 하드웨어 디코딩은 데이터 타입을 uint8으로 색상은 YUV로 밖에 가져올수가 없죠. 대부분 모델에 필요한 데이터 타입은 Float32가 일반적이고, 색상은 RGB나 BGR이 일반적인데 말이죠.

![omg](assets/omg.png)

그래서 위와 같은 이런 코드를 넣어야 하며, 이런 코드를 넣는 순간 초당 800 frames에서 초당 400 frames 이하로 급감합니다. 측정 할때 대부분의 속도 저하는 uint8에서 float32 업캐스팅 할때 심각한 속도 저하를 일으킵니다. 또 YUV2RGB도 무시할 수 없는 속도 저하가 있죠. 물론 일반적인 상황에서는 이런 작업들이 절대 느린 작업은 아니지만 초당 800 frames의 작업은 감당을 할 수 없는 것이죠.

더 심각한 것은 HEVC로 초당 1800 frames을 뽑아내도 이 친구만 만나면 얘도 초당 400 frames 이하로 급감한다는 겁니다. HEVC로 얻는 효과는 얻을수가 없는 것이죠. yuv_to_rgb 코드를 보다 연산을 빠르게 할 수 있게 개선이 됐지만, GPU 사용률이 심각하게 올라가서 이럴 땐 모델이 느려진다는 단점도 존재했었습니다.

그러면 빛좋은 개살구가 된건가요..? 아니요. 아직 포기하긴 이릅니다. 서치를 통해 조금이나마 해결 할 수 있는 방법을 찾았고, 그것은 바로 [CV-CUDA](https://github.com/CVCUDA/CV-CUDA)에 있었습니다.

(다음 편에 계속...)