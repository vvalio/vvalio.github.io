import { JSDOM } from "jsdom";
import path from "node:path";
import { readFileSync } from "node:fs";

const logBase = (tag: string) => `[${tag}][${new Date().toLocaleString()}]`;

const info = (input: string) => console.info(`${logBase("INFO")} ${input}`);
const warn = (input: string) => console.warn(`${logBase("WARN")} ${input}`);
const error = (input: string) => {
  console.error(`${logBase("ERROR")} ${input}`);
  console.error("Abort.");
  process.exit(1);
};

const ignoreAttr = "x-bundler-ignore";

// Context we operate on.
type BundlerContext = {
  htmlDirPath: string;
  doc: Document;
};

// Any <link rel="stylesheet"> that also has a href attribute ending with .css
type ReplaceableCssRef = {
  origTag: HTMLLinkElement;
  absoluteStylePath: string;
};

// Any <script src="whatever">, other script elements are ignored (those without src="...")
type ReplaceableScriptRef = {
  origTag: HTMLScriptElement;
  mountPoint: HTMLElement;
  absoluteScriptPath: string;
};

// Finds all link rel stylesheets and returns them
const findReplaceableCssRefs = ({
  htmlDirPath: htmlFilePath,
  doc,
}: BundlerContext): ReplaceableCssRef[] => {
  const allLinkElements = Array.from(doc.getElementsByTagName("link"));
  const result: ReplaceableCssRef[] = [];

  for (const element of allLinkElements) {
    if (element.hasAttribute(ignoreAttr)) {
      element.removeAttribute(ignoreAttr);
      continue;
    }

    if (
      element.getAttribute("rel") === "stylesheet" &&
      element.getAttribute("href")?.endsWith(".css")
    ) {
      const relativeCssPath = element.getAttribute("href")!;
      const absPath = path.resolve(path.join(htmlFilePath, relativeCssPath));

      result.push({
        origTag: element,
        absoluteStylePath: absPath,
      });
    }
  }

  info(`Found ${result.length} replaceable CSS <link> tag(s)`);
  return result;
};

// Finds all script srcs and returns them
const findReplaceableScriptRefs = ({
  htmlDirPath: htmlFilePath,
  doc,
}: BundlerContext): ReplaceableScriptRef[] => {
  const allScriptElements = Array.from(doc.getElementsByTagName("script"));
  const result: ReplaceableScriptRef[] = [];

  for (const element of allScriptElements) {
    if (element.hasAttribute(ignoreAttr)) {
      element.removeAttribute(ignoreAttr);
      continue;
    }

    if (
      element.getAttribute("src")?.endsWith(".js") &&
      !element.textContent?.trim()
    ) {
      const relativeScriptPath = element.getAttribute("src")!;
      const absPath = path.resolve(path.join(htmlFilePath, relativeScriptPath));

      result.push({
        origTag: element,
        mountPoint: element.parentElement!,
        absoluteScriptPath: absPath,
      });
    } else {
      warn("Found script tag with no valid src attribute or non-empty content");
    }
  }

  info(`Found ${result.length} replaceable JS <script> tags`);
  return result;
};

// Replaces the passed node (1) with a comment with the node's content as the comment in the passed document (2)
// and optionally appends the additional child (3) after the comment.
const replaceWithComment = (
  node: HTMLElement,
  doc: Document,
  additionalChild?: HTMLElement
) => {
  const commentText = ` ${node.outerHTML} `;
  const commentElement = doc.createComment(commentText);

  if (additionalChild) {
    node.replaceWith(commentElement, "\n", additionalChild);
  } else {
    node.replaceWith(commentElement);
  }
};

// Replaces all passed cssRefs and scriptRefs with inlined js/css content (that is, the file is read and copied into the tag)
const replaceTags = (
  cssRefs: ReplaceableCssRef[],
  scriptRefs: ReplaceableScriptRef[],
  { doc }: BundlerContext
) => {
  // For <style> tags we can ignore order and concatenate everything in one big tag
  let styleData = "";
  for (const cssRef of cssRefs) {
    try {
      const content = readFileSync(cssRef.absoluteStylePath, {
        encoding: "utf-8",
      });

      styleData += `\n${content}\n`;
    } catch (err) {
      error(
        `Reading file ${cssRef.absoluteStylePath} failed: ${JSON.stringify(
          err
        )}`
      );
    }

    replaceWithComment(cssRef.origTag, doc);
  }

  // Now the script blocks, which need to be mounted in their original locations
  // Also copies over attributes from script tags.
  for (const scriptRef of scriptRefs) {
    let content = "";
    try {
      content = readFileSync(scriptRef.absoluteScriptPath, {
        encoding: "utf-8",
      });
    } catch (err) {
      error(
        `Reading file ${scriptRef.absoluteScriptPath} failed: ${JSON.stringify(
          err
        )}`
      );
    }

    const newScriptTag = doc.createElement("script");
    newScriptTag.textContent = content;

    // Copy attributes
    for (const attrName of scriptRef.origTag.getAttributeNames()) {
      if (attrName !== "src") {
        newScriptTag.setAttribute(
          attrName,
          scriptRef.origTag.getAttribute(attrName)!
        );
      }
    }

    replaceWithComment(scriptRef.origTag, doc, newScriptTag);
  }

  const styleElement = doc.createElement("style");
  const headElements = doc.getElementsByTagName("head");

  if (headElements.length !== 1) {
    error(`Invalid number of <head> elements: ${headElements.length}`);
  }

  const headElement = headElements[0];

  styleElement.textContent = styleData;
  headElement.appendChild(styleElement);
};

const htmlpath = "src/html/index.html";
const parsedDoc = new JSDOM(readFileSync(htmlpath)).window.document;

console.log(parsedDoc.documentElement.outerHTML);

const context = { htmlDirPath: "src/html", doc: parsedDoc };
replaceTags(
  findReplaceableCssRefs(context),
  findReplaceableScriptRefs(context),
  context
);

console.log(parsedDoc.documentElement.outerHTML);
