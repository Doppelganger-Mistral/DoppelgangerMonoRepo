import Image from "next/image";
import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center bg-forest">
      {/* Left Content */}
      <div className="flex w-[55%] shrink-0 flex-col justify-center pl-10 md:pl-16 lg:pl-24 xl:pl-32 pr-4 py-12">
        <Image
          src="/titlefont.svg"
          alt="Doppelgänger"
          width={900}
          height={180}
          className="w-full h-auto drop-shadow-[0_3px_6px_rgba(0,0,0,0.5)] -ml-[40px]"
          priority
        />

        <p className="font-benguiat text-white text-lg sm:text-xl md:text-2xl lg:text-3xl mt-4 md:mt-6 lg:mt-8 leading-[1.4]">
          Trust no one,
          <br />
          not even your own voice
        </p>

        <div className="flex gap-4 md:gap-5 mt-6 md:mt-8 lg:mt-10">
          <Link
            href="/signup"
            className="px-6 md:px-8 lg:px-10 py-2 md:py-2.5 lg:py-3 border-[1.5px] border-cream rounded-full font-gordon text-cream text-xs md:text-sm uppercase tracking-[0.2em] cursor-pointer bg-transparent shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition-all duration-300 ease-out hover:bg-cream hover:text-forest hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,0,0,0.5)] no-underline"
          >
            Sign Up
          </Link>
          <Link
            href="/lobby"
            className="px-6 md:px-8 lg:px-10 py-2 md:py-2.5 lg:py-3 border-[1.5px] border-cream rounded-full font-gordon text-cream text-xs md:text-sm uppercase tracking-[0.2em] cursor-pointer bg-transparent shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition-all duration-300 ease-out hover:bg-cream hover:text-forest hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,0,0,0.5)] no-underline"
          >
            Log In
          </Link>
        </div>
      </div>

      {/* Right Image */}
      <div className="relative w-[45%] self-stretch overflow-hidden">
        <Image
          src="/landingicon.svg"
          alt="Doppelgänger illustration"
          fill
          className="object-contain object-right"
          priority
        />
      </div>
    </main>
  );
}
