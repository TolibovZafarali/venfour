import { ArrowRight } from "lucide-react";
import { Link } from "react-router";

import heroDesktop1440Avif from "@/assets/hero/hero-sedan-desktop-1440.avif";
import heroDesktop1440Jpeg from "@/assets/hero/hero-sedan-desktop-1440.jpg";
import heroDesktop1440Webp from "@/assets/hero/hero-sedan-desktop-1440.webp";
import heroDesktop720Avif from "@/assets/hero/hero-sedan-desktop-720.avif";
import heroDesktop720Jpeg from "@/assets/hero/hero-sedan-desktop-720.jpg";
import heroDesktop720Webp from "@/assets/hero/hero-sedan-desktop-720.webp";
import heroMobile1120Avif from "@/assets/hero/hero-sedan-mobile-1120.avif";
import heroMobile1120Jpeg from "@/assets/hero/hero-sedan-mobile-1120.jpg";
import heroMobile1120Webp from "@/assets/hero/hero-sedan-mobile-1120.webp";
import heroMobile640Avif from "@/assets/hero/hero-sedan-mobile-640.avif";
import heroMobile640Jpeg from "@/assets/hero/hero-sedan-mobile-640.jpg";
import heroMobile640Webp from "@/assets/hero/hero-sedan-mobile-640.webp";

const servicePaths = [
  {
    number: "01",
    title: "My car was totaled",
    description: "Check the value in your insurance report.",
    action: "Check my report",
    href: "/total-loss-review",
  },
  {
    number: "02",
    title: "I need my car’s value",
    description:
      "No report? Request a value check using your vehicle details.",
    action: "Request a value check",
    href: "/contact?topic=vehicle-value",
  },
  {
    number: "03",
    title: "My car was repaired",
    description: "See whether the accident lowered its resale value.",
    action: "Get help after repairs",
    href: "/contact?topic=diminished-value",
  },
] as const;

const credibilityItems = [
  "Similar vehicles",
  "Local market",
  "Clear explanation",
] as const;

const primaryActionClassName =
  "inline-flex min-h-12 items-center justify-center rounded-lg bg-brand px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none";

const narrowHeroSizes =
  "(max-width: 639px) calc(100vw - 2.5rem), calc(100vw - 4rem)";
const desktopHeroSizes =
  "(min-width: 1280px) 39rem, (min-width: 1024px) 48vw, calc(100vw - 4rem)";

export type ApprovedReview = {
  attribution: string;
  quote: string;
};

type HomePageProps = {
  reviews?: readonly ApprovedReview[];
};

export function HomePage({ reviews = [] }: HomePageProps) {
  return (
    <div className="w-full bg-white text-ink">
      <section className="border-b border-line bg-surface">
        <div className="mx-auto grid w-full max-w-7xl gap-8 px-5 py-9 sm:px-8 sm:py-12 lg:grid-cols-[minmax(0,0.82fr)_minmax(30rem,1.18fr)] lg:items-center lg:gap-14 lg:py-16 xl:gap-18 xl:py-18">
          <div className="max-w-xl lg:py-5">
            <h1 className="max-w-[11ch] text-[2.75rem] leading-[1.02] font-semibold tracking-[-0.05em] text-balance text-ink sm:text-[3.75rem] lg:text-[4rem]">
              Know what your car is worth.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-copy sm:text-lg sm:leading-8">
              After an accident, check an insurance report, your car’s market
              value, or value lost after repairs.
            </p>
            <a
              href="#services"
              className={`${primaryActionClassName} mt-7`}
            >
              Get started
            </a>
          </div>

          <picture className="block overflow-hidden rounded-xl bg-line">
            <source
              media="(max-width: 1023px)"
              type="image/avif"
              srcSet={`${heroMobile640Avif} 640w, ${heroMobile1120Avif} 1120w`}
              sizes={narrowHeroSizes}
            />
            <source
              media="(max-width: 1023px)"
              type="image/webp"
              srcSet={`${heroMobile640Webp} 640w, ${heroMobile1120Webp} 1120w`}
              sizes={narrowHeroSizes}
            />
            <source
              media="(max-width: 1023px)"
              type="image/jpeg"
              srcSet={`${heroMobile640Jpeg} 640w, ${heroMobile1120Jpeg} 1120w`}
              sizes={narrowHeroSizes}
            />
            <source
              type="image/avif"
              srcSet={`${heroDesktop720Avif} 720w, ${heroDesktop1440Avif} 1440w`}
              sizes={desktopHeroSizes}
            />
            <source
              type="image/webp"
              srcSet={`${heroDesktop720Webp} 720w, ${heroDesktop1440Webp} 1440w`}
              sizes={desktopHeroSizes}
            />
            <img
              src={heroDesktop720Jpeg}
              srcSet={`${heroDesktop720Jpeg} 720w, ${heroDesktop1440Jpeg} 1440w`}
              sizes={desktopHeroSizes}
              width={1440}
              height={1080}
              loading="eager"
              fetchPriority="high"
              decoding="async"
              alt=""
              data-hero-photo
              className="aspect-8/5 w-full object-cover lg:aspect-4/3"
            />
          </picture>
        </div>
      </section>

      <section
        id="services"
        className="section-anchor scroll-mt-20 bg-white"
        aria-labelledby="services-title"
        tabIndex={-1}
      >
        <div className="mx-auto w-full max-w-7xl px-5 py-12 sm:px-8 sm:py-15 lg:py-18">
          <div className="max-w-2xl">
            <h2
              id="services-title"
              data-anchor-heading
              className="text-3xl leading-tight font-semibold tracking-[-0.035em] text-ink sm:text-4xl"
            >
              How can Venfour help?
            </h2>
            <p className="mt-3 text-base leading-7 text-copy">
              Start with the situation that fits your car today.
            </p>
          </div>

          <ol className="mt-8 grid border-y border-line lg:grid-cols-3 lg:divide-x lg:divide-line">
            {servicePaths.map((path) => (
              <li
                key={path.number}
                className="border-b border-line last:border-b-0 lg:border-b-0"
              >
                <Link
                  to={path.href}
                  className="group flex h-full min-h-52 flex-col px-1 py-6 outline-none transition-colors hover:bg-surface focus-visible:bg-brand-soft focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset motion-reduce:transition-none sm:px-5 lg:min-h-64 lg:px-7 lg:py-7"
                >
                  <span className="text-xs font-semibold tabular-nums text-brand">
                    {path.number}
                  </span>
                  <h3 className="mt-5 max-w-[17rem] text-xl leading-snug font-semibold tracking-[-0.025em] text-ink sm:text-2xl">
                    {path.title}
                  </h3>
                  <p className="mt-3 max-w-xs text-sm leading-6 text-copy sm:text-[0.9375rem]">
                    {path.description}
                  </p>
                  <span className="mt-6 inline-flex min-h-11 items-center gap-2 self-start text-sm font-semibold text-brand group-hover:text-brand-strong lg:mt-auto lg:pt-6">
                    {path.action}
                    <ArrowRight
                      className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                      aria-hidden
                    />
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        className="border-y border-line bg-surface"
        aria-labelledby="credibility-title"
      >
        <h2 id="credibility-title" className="sr-only">
          Why Venfour
        </h2>
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-7">
          <ul className="flex flex-wrap items-center gap-y-2 text-sm font-semibold text-ink">
            {credibilityItems.map((item) => (
              <li
                key={item}
                className="border-l border-line px-4 first:border-l-0 first:pl-0"
              >
                {item}
              </li>
            ))}
          </ul>
          <Link
            to="/methodology"
            className="group inline-flex min-h-11 shrink-0 items-center gap-2 self-start rounded-sm text-sm font-semibold text-brand transition-colors hover:text-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4 motion-reduce:transition-none sm:self-auto"
          >
            See how Venfour works
            <ArrowRight
              className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
              aria-hidden
            />
          </Link>
        </div>
      </section>

      {reviews.length > 0 ? (
        <section className="bg-white" aria-labelledby="reviews-title">
          <div className="mx-auto w-full max-w-7xl px-5 py-12 sm:px-8 sm:py-15">
            <h2
              id="reviews-title"
              className="text-3xl leading-tight font-semibold tracking-[-0.035em] text-ink"
            >
              What customers say
            </h2>
            <div className="mt-7 grid gap-7 border-y border-line py-7 md:grid-cols-3 md:divide-x md:divide-line">
              {reviews.slice(0, 3).map((review, index) => (
                <figure key={`${review.attribution}-${index}`} className="md:px-6 md:first:pl-0 md:last:pr-0">
                  <blockquote className="text-base leading-7 text-ink">
                    <p>“{review.quote}”</p>
                  </blockquote>
                  <figcaption className="mt-4 text-sm font-semibold text-copy">
                    {review.attribution}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
