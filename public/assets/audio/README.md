# BGM · 스팅어 파일 투입 가이드

이 폴더에 아래 이름으로 mp3(또는 wav)를 넣으면 프로시저럴 사운드 대신 자동으로 사용됩니다.
파일이 없으면 코드 합성(프로시저럴)으로 자동 폴백하므로, 원하는 것만 넣어도 됩니다.

| 파일명 | 용도 | 재생 |
|--------|------|------|
| `bgm_title.mp3` | 타이틀·챔피언 선택 화면 | 루프 |
| `bgm_game.mp3` | 인게임 전투 | 루프 |
| `bgm_victory.mp3` | 승리 화면 스팅어 | 1회 |
| `bgm_defeat.mp3` | 패배 화면 스팅어 | 1회 |

## Suno 생성 팁
- **Instrumental(연주곡) 모드**로 생성 (보컬 자동삽입 방지)
- 승리/패배 스팅어는 **8~12초**로 짧게 (Suno에서 곡을 짧게 요청하거나, 앞부분만 잘라 사용)
- 루프 트랙은 길이 무관 — 코드가 이음새 없이 반복 재생함(필요 시 크로스페이드 후처리 권장)

## Suno 프롬프트 (마음의 협곡 세계관 · 밤의 숲 · D dorian)

**인게임 전투** (`bgm_game.mp3`):
```
dark fantasy MOBA battle music, mysterious enchanted moonlit forest, driving but
controlled orchestral strings, celtic harp arpeggios, subtle heartbeat percussion,
ethereal choir pads, tense yet focused, building energy, D dorian, instrumental,
no vocals, seamless loop, 100 BPM
```

**타이틀 테마** (`bgm_title.mp3`):
```
epic yet hopeful fantasy title theme, warm cinematic orchestral strings, soft
celestial choir, celtic harp, enchanted night forest atmosphere, gentle heroic
emotional build, calming, D dorian, instrumental, no vocals, 90 BPM
```

**승리 스팅어** (`bgm_victory.mp3`, 8~12초):
```
short triumphant fantasy victory fanfare, soaring brass and strings, uplifting
choir swell, bright bells, heroic and warm, D major, instrumental, no vocals
```

**패배 스팅어** (`bgm_defeat.mp3`, 8~12초):
```
short somber fantasy defeat sting, gentle descending strings, soft solo cello,
melancholic but hopeful and comforting, quiet resolve, D minor, instrumental,
no vocals
```
