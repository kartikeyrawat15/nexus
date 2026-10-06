"use client";
import Image from "next/image";
import { Button } from "./ui/button";
import { AiFillGithub } from "react-icons/ai";
import { siteConfig } from "@/config/site";

const TopNavbar: React.FC = () => {
  return (
    <div className="flex h-12 w-full items-center justify-between border-b px-4">
      <div className="flex items-center gap-x-2">
        <Image src="/icon.svg" alt="Jira logo" width={25} height={25} />
        <span className="text-sm font-medium text-gray-600">Jira Clone</span>
        <Button
          href={siteConfig.links.github}
          target="_blank"
          className="ml-3 flex gap-x-2"
        >
          <AiFillGithub />
          <span className="text-sm font-medium">Github Repo</span>
        </Button>
      </div>
      <span className="text-sm text-gray-600">Wayline demo</span>
    </div>
  );
};

export { TopNavbar };
