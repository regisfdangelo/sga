-- ============================================================
-- SGA | 22_telefone_emprestimo.sql
-- Telefone do solicitante em cada emprestimo.
--
-- PARA QUE SERVE
-- ------------------------------------------------------------
-- A tela Emprestimo / Devolucao passa a pedir o TELEFONE do
-- solicitante no registro de emprestimo (campo obrigatorio no
-- formulario) e grava junto com nome e e-mail. Serve para o
-- arquivista localizar quem esta com a pasta emprestada.
--
-- O QUE ESTE ARQUIVO FAZ
-- ------------------------------------------------------------
-- 1) Cria a coluna public.emprestimos.telefone (text).
-- 2) Comentario na coluna explicando o papel dela.
--
-- REGRAS
-- ------------------------------------------------------------
-- - Idempotente: pode ser executado mais de uma vez.
-- - A coluna fica NULL-able de PROPOSITO: os emprestimos ja
--   gravados continuam validos e o cadastro novo nao trava por
--   causa deles. O campo e' OBRIGATORIO no formulario (o front
--   recusa o envio vazio); se um dia quiser travar tambem no
--   banco, rode o bloco (3) abaixo apos preencher os nulos.
-- - RLS: a politica de emprestimos e' por tabela (sql/04), vale
--   para as colunas novas sem precisar de policy extra.
-- - INSERT ja e' feito direto pelo front (PostgREST), nao ha RPC
--   de emprestimo a alterar.
--
-- Onde executar: Supabase Dashboard > SQL Editor > New query > Run.
-- Ordem: apos 21_limite_pastas_caixa.sql.
-- Depois de rodar: recarregue o navegador (Ctrl+F5).
-- ============================================================


-- ============================================================
-- 1) COLUNA
-- ============================================================
ALTER TABLE public.emprestimos
  ADD COLUMN IF NOT EXISTS telefone text;

COMMENT ON COLUMN public.emprestimos.telefone IS
  'Telefone do solicitante, informado no registro de emprestimo (obrigatorio no formulario).';


-- ============================================================
-- 2) VERIFICACAO
-- ============================================================
-- a) coluna criada (esperado: telefone, tipo text, nullable = sim)
SELECT c.column_name, c.data_type, c.is_nullable, c.character_maximum_length
  FROM information_schema.columns c
 WHERE c.table_schema = 'public'
   AND c.table_name   = 'emprestimos'
   AND c.column_name  = 'telefone';

-- b) emprestimos sem telefone (os antigos, ate' o formulario
--    comecar a preencher - esperado: apenas os pre-existentes)
SELECT count(*) AS sem_telefone
  FROM public.emprestimos
 WHERE telefone IS NULL;


-- ============================================================
-- 3) (OPCIONAL) TRAVAR NO BANCO TAMBEM - so depois de os
--    emprestimos novos ja terem telefone e de voce ter decidido
--    o destino dos nulos antigos (preencher ou excluir).
--    Descomente para usar.
-- ============================================================
-- -- preenche os nulos com um marcador visivel (ou apague as linhas)
-- UPDATE public.emprestimos
--    SET telefone = 'nao informado'
--  WHERE telefone IS NULL;
--
-- ALTER TABLE public.emprestimos
--   ALTER COLUMN telefone SET NOT NULL;
--
-- SELECT c.column_name, c.is_nullable
--   FROM information_schema.columns c
--  WHERE c.table_schema = 'public'
--    AND c.table_name   = 'emprestimos'
--    AND c.column_name  = 'telefone';
