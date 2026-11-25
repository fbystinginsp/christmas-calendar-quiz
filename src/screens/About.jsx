import { t } from '../i18n/strings.js';

export default function About() {
  return (
    <section>
      <h1 className="text-2xl font-bold text-gold-400">{t.about.title}</h1>
      <div className="mt-4 space-y-4">
        {t.about.sections.map(([title, body]) => (
          <div key={title} className="rounded-2xl bg-pine-800 border border-white/10 p-4">
            <h2 className="font-semibold text-gold-400">{title}</h2>
            <p className="mt-1 text-white/85">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
