# Contrato visual — acesso SGD

## Fundamentos

A tela de acesso expressa o caráter institucional do MAPA com fotografia agrícola, verde profundo e dourado de apoio. A fotografia é sempre uma camada de contexto: os controles e o conteúdo devem conservar leitura inequívoca sobre ela.

## Tokens

| Uso | Token / valor |
| --- | --- |
| Verde institucional forte | `gov-900` / `#0F5132` |
| Verde de ação | `gov-700` / `#198754` |
| Verde de foco | `gov-500` / `#20C997` |
| Dourado de apoio | `gold` / `#F4B400` |
| Fundo do painel claro | `rgba(255, 255, 255, 0.20)` |
| Fundo do painel escuro | `rgba(7, 28, 20, 0.58)` |
| Borda de luz | `rgba(255, 255, 255, 0.30)` |
| Desfoque do painel | `backdrop-blur-xl` (24 px) |
| Desfoque da cena | `backdrop-blur-sm` (4 px) |
| Sombra do painel | `0 24px 64px rgba(0, 0, 0, .36)` |
| Foco de teclado | anel de 2 px em `#20C997`, afastamento de 2 px |

Os tokens CSS institucionais ficam em `src/index.css`; o componente usa as utilidades Tailwind correspondentes. Evite introduzir cores isoladas em componentes quando já houver token semântico aplicável.

## Camadas e composição

1. Imagem agrícola em tela inteira, `cover` e centrada.
2. Gradiente verde-azulado escuro para garantir contraste, seguido de desfoque discreto da cena.
3. Cartão central glassmorphism: transparência, borda de luz, sombra profunda e desfoque de fundo.
4. Conteúdo com largura máxima de 448 px, respiro mínimo de 16 px em telas de 375 px.

Em telas pequenas, o painel permanece em fluxo, com utilidades no topo e conteúdo vertical rolável. A fotografia não pode prejudicar a leitura nem ocultar controles.

## Interação e acessibilidade

- Todos os controles possuem nome acessível e indicação visual de foco.
- Campos obrigatórios são indicados com asterisco e mantêm `required` nativo.
- `hover` aumenta o contraste de superfícies ou eleva o botão; `active` reduz discretamente a escala.
- `disabled` reduz opacidade, remove o cursor de ação e impede nova submissão.
- `loading` troca o rótulo por um spinner e comunica o estado de autenticação.
- A utilidade de alto contraste usa superfícies opacas e contornos mais fortes; não depende apenas de cor para comunicar erros ou estados.
- O erro do formulário usa `role="alert"`; o botão de senha anuncia se irá exibir ou ocultar o conteúdo.

## Pontos de validação responsiva

- **375 px:** sem cortes horizontais; controles de utilidade compactos; formulário fácil de tocar.
- **768 px:** cartão até 448 px, margens amplas e identidade institucional legível.
- **1280 px+:** composição centralizada, fotografia visível como contexto e nenhum conteúdo além da largura de leitura.
