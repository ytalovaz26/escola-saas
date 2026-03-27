"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SchoolLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function go(href: string) {
    router.push(href);
    setOpen(false);
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* SIDEBAR DESKTOP */}
      <aside className="hidden md:flex w-64 flex-col border-r bg-white p-4">
        <h2 className="text-lg font-bold mb-6">🏫 Painel</h2>

        <nav className="flex flex-col gap-2 text-sm">
          <button onClick={() => go("/school")} className="text-left hover:bg-slate-100 p-2 rounded-xl">
            Dashboard
          </button>

          <button onClick={() => go("/school/classes")} className="text-left hover:bg-slate-100 p-2 rounded-xl">
            Turmas
          </button>

          <button onClick={() => go("/school/students")} className="text-left hover:bg-slate-100 p-2 rounded-xl">
            Alunos
          </button>

          <button onClick={() => go("/school/enrollments")} className="text-left hover:bg-slate-100 p-2 rounded-xl">
            Matrículas
          </button>

          <button onClick={() => go("/school/parents")} className="text-left hover:bg-slate-100 p-2 rounded-xl">
            Responsáveis
          </button>

          <button onClick={() => go("/school/teachers")} className="text-left hover:bg-slate-100 p-2 rounded-xl">
            Professores
          </button>

          <button onClick={() => go("/school/attendance")} className="text-left hover:bg-slate-100 p-2 rounded-xl">
            Presença
          </button>

          <button onClick={() => go("/school/finance")} className="text-left hover:bg-slate-100 p-2 rounded-xl">
            Financeiro
          </button>
        </nav>
      </aside>

      {/* MOBILE TOPBAR */}
      <div className="flex-1 flex flex-col">
        <header className="md:hidden flex items-center justify-between p-4 border-b bg-white">
          <button onClick={() => setOpen(!open)}>☰</button>
          <span className="font-semibold">Painel</span>
        </header>

        {/* MENU MOBILE */}
        {open && (
          <div className="md:hidden bg-white border-b p-4 flex flex-col gap-2 text-sm">
            <button onClick={() => go("/school")}>Dashboard</button>
            <button onClick={() => go("/school/classes")}>Turmas</button>
            <button onClick={() => go("/school/students")}>Alunos</button>
            <button onClick={() => go("/school/enrollments")}>Matrículas</button>
            <button onClick={() => go("/school/parents")}>Responsáveis</button>
            <button onClick={() => go("/school/teachers")}>Professores</button>
            <button onClick={() => go("/school/attendance")}>Presença</button>
            <button onClick={() => go("/school/finance")}>Financeiro</button>
          </div>
        )}

        {/* CONTEÚDO */}
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}