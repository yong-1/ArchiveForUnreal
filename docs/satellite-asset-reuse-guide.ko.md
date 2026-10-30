# 인공위성 에셋 재사용 가이드

작성일: 2026-10-17 · 대상: Windows·NAS/SMB 환경의 소규모 방송 제작팀

이 문서는 방송 프로젝트의 인공위성을 독립 콘텐츠 패키지로 만들어 팀 라이브러리에 보존하고, 원본 방송 프로젝트 없이 다른 제작 프로젝트에서 재사용하는 방법을 정리한다. 수동으로 가능한 Unreal 작업과 앞으로 구현할 자동화 도구를 구분한다. 이 문서 작성으로 자동화 기능이 구현되거나 실제 프로젝트 검증이 완료된 것은 아니다.

연계 설계: [SDD — 팀 전용 Fab 설계](SDD.ko.md)의 7.3절·12장, [TDD — 수용 테스트](TDD.ko.md)의 PKG 사례·ARC-E2E-07/08.

## 1. 목표와 기본 개념

원본 방송 프로젝트 A에 로켓·인공위성·지구·발사대가 있다고 가정한다. 필요한 것은 인공위성과 그 인공위성이 작동하는 데 필요한 자산이다. 무관한 로켓·지구·발사대를 모두 배포하지 않는다.

```text
원본 방송 프로젝트 A
  → 인공위성의 재사용 범위 지정
  → 작업 프로젝트 B로 필요한 자산 복사
  → 한 폴더 아래 정리·참조 수정
  → 콘텐츠 패키지 ZIP 생성
  → 원본 접근을 차단한 프로젝트 C에서 검증
  → 팀 라이브러리에 보존·게시
  → 다른 팀원이 다운로드하여 제작 프로젝트에 추가
```

**완료 기준:** 원본 A와 원본 NAS 공유에 접근하지 않고, 최종 다운로드 ZIP과 명시된 엔진·플러그인만으로 인공위성의 외형·재질·선언한 동작을 재현한다. 라이브러리 서버와 패키지 보존 저장소는 이용 가능해야 한다.

| 구분 | 의미 |
| --- | --- |
| 원본 프로젝트 A | 실제 방송 제작에 사용한 프로젝트. 추출 과정에서 보존한다 |
| 작업 프로젝트 B | 인공위성을 분리하고 정리하는 임시 또는 검증용 UE 프로젝트 |
| 검증 프로젝트 C | 원본 A·작업 B를 참조하지 않고 최종 ZIP의 재사용 가능성을 확인하는 깨끗한 프로젝트 |
| 콘텐츠 패키지 ZIP | 선택 자산·의존성·manifest·사용 설명을 담은 배포물. 전체 UE 프로젝트와 구별한다 |

## 2. 사람이 먼저 결정할 재사용 범위

대표 자산과 재사용 목표를 지정한다. 시스템이 파일 이름이나 외형만 보고 인공위성 범위를 확정하지 않는다.

| 목표 | 포함할 내용·검증 범위 |
| --- | --- |
| 모델만 | 메시·재질·텍스처, 외형 확인 |
| 조립된 인공위성 | 위 항목과 부품 구성·상대 위치·속성 |
| 동작하는 인공위성 | 위 항목과 Blueprint 동작·관련 시퀀스·Actor 바인딩 |

독립 Blueprint가 있다면 `BP_Satellite` 같은 자산을 대표 root로 지정한다. 여러 레벨 Actor를 배치해서 만든 인공위성은 작업 복제본에서 재사용 가능한 Blueprint 또는 검증 가능한 구성 자산으로 정리한다. Unreal은 선택 Actor의 속성·상대 위치를 포함한 Blueprint 생성 방법을 제공하지만, 어떤 변환 방식이 해당 구성에 맞는지와 변환 후 동작은 확인해야 한다. [Epic Blueprint 생성 문서](https://dev.epicgames.com/documentation/en-us/unreal-engine/creating-blueprint-classes-in-unreal-engine)

인공위성이 지구 Actor나 방송 전체 시퀀스를 직접 참조한다면 그 사실을 기록한다. 필요한 참조를 숨겨서 제외하지 않는다. 작업 복제본에서 연결을 분리하거나 패키지 범위를 조정한 뒤 다시 검증한다.

## 3. 수동으로 분리하는 기본 절차

1. 원본 A의 작업 복제본을 준비하고 대표 자산과 재사용 목표를 확인한다.
2. 호환되는 엔진으로 빈 작업 프로젝트 B를 준비한다.
3. 원본의 Content Browser에서 대표 자산을 선택하고 **Asset Actions → Migrate**를 실행한다.
4. Asset Report에서 필요한 의존성을 확인하고, 대상은 **B의 `Content` 폴더**로 지정한다.
5. B만 열어 메시·재질·텍스처·Blueprint·시퀀스와 필요한 실행 환경을 확인한다.

Migrate는 선택 자산의 참조·의존성을 함께 복사하며 원본을 제거하는 작업이 아니다. 처음에는 원본의 폴더 구조대로 여러 위치에 복사될 수 있다. 프로젝트 설정·필수 플러그인·C++ 모듈·외부 파일까지 모두 자동으로 준비됐다고 가정하지 않는다. [Epic Migrate 문서](https://dev.epicgames.com/documentation/en-us/unreal-engine/migrating-assets-in-unreal-engine)

## 4. 작업 프로젝트에서 한 폴더로 정리

목표는 다음처럼 하나의 상위 폴더 아래에 인공위성 자산을 모으는 것이다. 하위 폴더 구조는 유지할 수 있다.

```text
Content/
  TeamAssets/
    Satellite_001/
      Collected/
        Blueprints/
        Props/
        Common/
        Sequences/
```

**정리는 Unreal 에디터 안에서 수행한다.** Windows 탐색기로 흩어진 `.uasset` 파일을 이동·이름 변경하면 내부 참조가 깨질 수 있다. Content Browser의 이동·복사 또는 Unreal 에디터 API를 사용한다. [Epic 자산 관리 문서](https://dev.epicgames.com/documentation/en-us/unreal-engine/working-with-assets-in-unreal-engine)

수동 정리 시에는 관련 자산을 새 폴더 아래로 이동하고 저장한다. 공유 재질을 복사했다면 인공위성이 새 복사본을 참조하는지 확인한다. 이전 경로의 Redirector는 Fixup으로 참조를 정리하고, 필요한 자산이 새 위치로 연결됐는지 다시 검사한다. Redirector 정리가 실패한 경우 완료로 처리하지 않는다. [Epic Redirector 문서](https://dev.epicgames.com/documentation/en-us/unreal-engine/asset-redirectors-in-unreal-engine)

## 5. 폴더 정리 자동화 방법

구현할 도구의 사용자 흐름은 **대표 에셋 선택 → 패키지 이름·목표 입력 → 포함 목록 확인 → 자동 정리·검증 → ZIP 생성**이다. 초기에는 에디터 버튼과 Python으로 만들고, 이후 웹 요청을 받아 실행하는 Windows UE worker로 연결할 수 있다.

### 5.1 의존성 목록 수집

대표 root에서 참조하는 자산을 찾고, 각 자산의 의존성을 반복 조회한다. 방문 집합으로 중복·순환을 막고 hard/soft/management 참조를 구분한다. `AssetRegistry.get_dependencies()`는 디스크에 저장된 참조를 조회하므로 동적 경로·외부 파일·레벨 Actor 바인딩 등을 모두 증명하는 기능으로 취급하지 않는다. [공식 AssetRegistry API](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/AssetRegistry?application_version=5.4)

각 항목은 다음처럼 분류한다.

- **포함:** 메시·재질·텍스처·Blueprint·관련 시퀀스 등 패키지에 보존할 파일.
- **환경 전제조건:** 필요한 엔진·플러그인·C++ 모듈 등 대상에 준비해야 하는 구성.
- **미해결:** 원본 레벨·외부 파일·동적 참조 등 아직 처리하지 못한 항목.

필수 미해결 항목이 남으면 게시를 중단하고 원인과 필요한 조치를 표시한다.

### 5.2 경로 매핑과 이동

이동 전에 기존 경로와 새 경로의 대응표를 만든다. 초기 구현은 원래 하위 경로를 보존해 동명 자산 충돌을 줄이는 방식으로 한다.

| 기존 경로 | 새 경로 예시 |
| --- | --- |
| `/Game/Blueprints/BP_Satellite` | `/Game/TeamAssets/Satellite_001/Collected/Blueprints/BP_Satellite` |
| `/Game/Props/Satellite/SM_Body` | `/Game/TeamAssets/Satellite_001/Collected/Props/Satellite/SM_Body` |
| `/Game/Common/Materials/M_Metal` | `/Game/TeamAssets/Satellite_001/Collected/Common/Materials/M_Metal` |

이름 충돌·목적지 존재·루트 범위·이미 처리한 자산을 먼저 검사한다. 엔진/플러그인 자산을 무조건 `/Game` 아래로 옮기지 않는다. 복사는 원본 보존을 위해 사용하고, 실제 정리·이동은 작업 B에서 수행한다.

### 5.3 참조 수정·저장·검증

| 처리 | API 또는 도구 후보 |
| --- | --- |
| 일괄 경로 이동·이름 변경 | `AssetTools.rename_assets()` |
| 개별 자산 이동 | `EditorAssetLibrary.rename_asset()` |
| 변경 자산 저장 | `save_loaded_assets()` 또는 해당 저장 API |
| 이전 경로 참조 정리 | 에디터 Redirector Fixup 또는 검증된 commandlet/C++ 어댑터 |
| 재조회·검증 | 의존성 재수집·패키지 로드·Blueprint 컴파일·시퀀스 실행 |

단순히 자산을 각각 복제하는 것만으로 새 복사본끼리 참조가 연결됐다고 가정하지 않는다. 경로 매핑을 적용한 뒤 이전 위치·패키지 밖 참조를 검사한다. 저장 성공·파일 수 일치만으로 완료하지 않는다. [AssetTools API](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/AssetTools?application_version=5.4), [EditorAssetLibrary API](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/EditorAssetLibrary?application_version=5.4)

Python은 Unreal 에디터 환경에서 실행한다. 서버 자동화는 해당 엔진이 설치된 worker에서 에디터/commandlet을 실행하는 구조다. UI를 여는 API를 무인 작업에 그대로 사용하지 않고 UE 5.3·5.4·5.6·5.8 및 커스텀 build별로 실제 동작을 검증한다. [Epic Python 자동화 문서](https://dev.epicgames.com/documentation/en-us/unreal-engine/scripting-the-unreal-editor-using-python)

## 6. 콘텐츠 패키지 ZIP 만들기

검증할 배포물은 다음과 같은 구조다. 아래 폴더는 구조 예시이며, 실제 포함 파일은 의존성·경로 매핑 결과로 확정한다.

```text
Satellite_001_v1_UE54.zip
  manifest.json
  README.ko.md
  Content/
    TeamAssets/
      Satellite_001/
        Collected/
          …정리된 자산과 필요한 동반 파일…
```

콘텐츠 패키지는 `.uproject`를 포함한 전체 프로젝트 ZIP과 다르다. ZIP 자체를 UE 프로젝트로 여는 방식이 아니라, 호환되는 프로젝트에 콘텐츠를 추가하여 사용한다. 작업 B는 제작·검증에 사용하고 배포물에는 필요한 콘텐츠만 담는다.

manifest와 서버 메타데이터에는 패키지 ID·버전·대표 root·재사용 목표·파일 목록/경로/크기/체크섬·필요 엔진/build/플러그인·포함/미해결 의존성·검증 결과·출처 영상·사용 제약을 기록한다. 원본 절대 경로나 자격 증명을 넣지 않는다. 원본 FBX가 없다면 존재하는 것처럼 표시하지 않는다.

최종 ZIP과 manifest·검증 보고서는 원본 A와 별개의 관리 저장소에 보존한다. 이후 다운로드는 이 보존본을 제공하며 원본 프로젝트에서 다시 추출하지 않는다. 수정본은 v2로 등록하고 v1의 파일·참조·다운로드를 덮어쓰지 않는다. 검증된 엔진 조합만 호환 목록에 표시한다.

## 7. 다른 프로젝트에서 사용하기

서비스가 구현되면 사용자는 라이브러리에서 인공위성을 검색하고 버전·엔진·필요 플러그인·구성을 확인한 뒤 ZIP 다운로드 또는 **프로젝트에 추가**를 선택한다.

추가 도구는 ZIP·manifest의 무결성, 상대 경로, 동명 충돌과 대상 환경을 검사하고 정해진 Content 경로로 이행한다. 대상의 기존 자료를 무단 덮어쓰지 않는다. 배포 후 폴더명·위치를 탐색기에서 임의로 바꾸지 않는다. 경로를 변경해야 하면 에디터에서 참조 수정 후 다시 검증한다.

도구 구현 전 수동 시험에서는 별도 검증 프로젝트에 패키지를 구성하고, UE의 Migrate 흐름으로 실제 제작 프로젝트의 `Content`에 이행해 확인할 수 있다. 이 과정에 필요한 검증 프로젝트와 원본 방송 프로젝트 A는 서로 다르다. 콘텐츠 ZIP을 풀기만 하면 엔진·플러그인·C++ 요구사항까지 자동 설치되는 것은 아니다.

## 8. 게시 전 확인 항목

- [ ] 재사용 목표와 대표 root가 명확하다.
- [ ] 무관한 로켓·지구·발사대가 들어가지 않았다. 필요한 참조가 있으면 이유와 범위를 표시했다.
- [ ] 필수 미해결 의존성·이전 경로 참조·누락 파일이 없다.
- [ ] 최종 ZIP을 내려받아 해제한 결과로 시험했다. 작업 B를 직접 열어 통과한 결과로 대체하지 않았다.
- [ ] 원본 A·원본 NAS·작업 B 접근을 차단한 C에서 정상 재현했다.
- [ ] 외형·재질·부품 배치와 선언한 시퀀스 동작을 확인했다.
- [ ] 필요 엔진/build·플러그인·모듈과 지원 범위를 기록했다.
- [ ] 원본·대상 기존 파일이 보존됐고 ZIP 파일/체크섬이 일치한다.
- [ ] 출처 영상·패키지 버전·검증 결과·다운로드 권한을 기록했다.
- [ ] 서버에 패키지와 메타데이터·보고서가 보존되어 원본 프로젝트 없이 재다운로드할 수 있다.

## 9. 현재 상태와 구현 범위

Migrate·Content Browser 이동·Redirector 정리는 Unreal이 제공하는 작업이다. 대표 에셋 선택 후 의존성 수집·경로 정리·검증·압축·게시까지 이어지는 팀 전용 버튼/worker는 개발할 자동화 기능이다. 현재 SDD/TDD는 이 기능의 목표 설계이며, 이 가이드에서 실제 도구 실행·파일 이동·NAS 변경·UE 검증은 수행하지 않았다.
