"use client";

import { useEffect } from "react";

export default function MotionController() {
  useEffect(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>(".hero-copy,.hero-photo,.demo-intro,.demo-frame,.section-head,.outcome-grid,.steps,.truth-label,.truth-copy,.price-grid,.pricing-close,.final-cta>*,.footer-main"));
    items.forEach((item) => item.classList.add("reveal-ready"));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      items.forEach((item) => item.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.14, rootMargin: "0px 0px -7%" });
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);
  return null;
}
